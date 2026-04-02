import { ref, computed, reactive } from "vue";
import { formDataToProjectFields } from "@/utils/projectFormHelpers";
import { useProjectStore } from "@/stores/pinia/projectStore";
import { updateStandaloneProjectMarkerColor } from "@/services/map/standaloneProjectMarkers";
import { useChangeRequests } from "@/composables/changes/useChanges";
import { trpc } from "@/client";
import { useToast } from "@/composables/ui/useToast";
import { t } from "@/locales";
import { createProjectFromUserContribution } from "@/utils/typeFactories";
import {
  projectSchema,
  getValidationErrorsMap,
  type FieldChange,
} from "@shared/validation/schemas";
import { prepareProjectValidationData } from "@/utils/validationHelpers";
import type { Project, ProjectFormData } from "@/types/index";
import type { DBCity } from "../../../../back/src/db/schema";
import type { ApprovalStatus } from "@shared/types";

// Helper to serialize values for JSONB storage
// Dates must be converted to ISO strings to prevent double-serialization
function serializeValue(value: unknown): unknown {
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (value === null || value === undefined || value === "") {
    return null;
  }
  return value;
}

// Kinda odd function signature but it makes use of FieldComparator, without fieldname all fields are tagged as changed
function projectComparator(
  _fieldName: keyof ProjectFormData,
  original: ProjectFormData[keyof ProjectFormData],
  current: ProjectFormData[keyof ProjectFormData],
): boolean {
  // Handle Date objects by comparing their time values
  if (original instanceof Date && current instanceof Date) {
    return original.getTime() !== current.getTime();
  }

  // Handle cases where one is Date and other is null/undefined
  if ((original instanceof Date && !current) || (!original && current instanceof Date)) {
    return true;
  }

  return original !== current;
}

interface EditableProjectFormOptions {
  entityId: string;
  initialData: ProjectFormData; // Original backend values for "modified from X" comparison
  currentData?: ProjectFormData; // Current values to display in form (if different from initialData after local saves)
  entityStatus: ApprovalStatus | null;
  localOnly?: boolean; // If true, only update local store, don't submit to backend
  getAvailableCities?: () => {
    id: number;
    name: string;
    nameLocal: string | null;
    countryCode: string;
    lat: number;
    lng: number;
    distance?: number;
  }[]; // Function to get current cities dynamically
  onSubmitted?: () => void;
  onClose?: () => void;
}

export function useEditableProjectForm(options: EditableProjectFormOptions) {
  const projectStore = useProjectStore();
  const { submitMultipleFieldChanges } = useChangeRequests();
  const toast = useToast();

  const isSubmitting = ref(false);
  const changeReason = ref("");

  // Create reactive objects for original (comparison baseline) and current (displayed) data
  // originalData is for comparison ("modified from X"), formData is for editing
  const originalData = reactive({ ...options.initialData }) as ProjectFormData;
  const formData = reactive({ ...(options.currentData ?? options.initialData) }) as ProjectFormData;

  // Check if a specific field has changed
  function hasChanged(fieldName: keyof ProjectFormData): boolean {
    return projectComparator(fieldName, originalData[fieldName], formData[fieldName]);
  }

  // Check if any field has changed
  const hasChanges = computed(() => {
    // oxlint-disable-next-line no-unsafe-type-assertion
    return Object.keys(formData).some((key) => hasChanged(key as keyof ProjectFormData));
  });

  // Reset all changes
  function resetChanges() {
    Object.assign(formData, originalData);
    changeReason.value = "";
  }

  // Get array of changes to submit
  function getChangesToSubmit(): FieldChange[] {
    const changes: FieldChange[] = [];

    for (const key of Object.keys(formData)) {
      // oxlint-disable-next-line no-unsafe-type-assertion
      const fieldName = key as keyof ProjectFormData;
      if (hasChanged(fieldName)) {
        changes.push({
          fieldName: fieldName,
          oldValue: serializeValue(originalData[fieldName]),
          newValue: serializeValue(formData[fieldName]),
          changeReason: changeReason.value,
        });
      }
    }

    return changes;
  }

  // Get CSS classes for a field based on change status
  function getFieldClasses(fieldName: keyof ProjectFormData) {
    return {
      "field-changed": hasChanged(fieldName),
    };
  }

  // Handle approved entity updates (via change requests)
  async function handleApprovedEntityUpdate(changes: FieldChange[]) {
    await submitMultipleFieldChanges("project", options.entityId, changes);

    toast.add({
      severity: "success",
      summary: t("submission.changeRequestSubmitted"),
      detail: t("submission.changeRequestSubmitted"),
      life: 3000,
    });
  }

  // Show error toast
  function showErrorToast() {
    toast.add({
      severity: "error",
      summary: t("toast.submissionFailed"),
      detail: t("moderation.rejectionFailedDetail"),
      life: 3000,
    });
  }

  // Update city object when cityId changes
  function getCityObjectForUpdate(currentProject: Project): DBCity | null {
    let cityObject: DBCity | null = currentProject.city;

    if (
      formData.cityId &&
      formData.cityId !== currentProject.cityId &&
      options.getAvailableCities
    ) {
      const citiesArray = options.getAvailableCities();
      const newCity = citiesArray.find((c) => c.id === formData.cityId);
      if (newCity) {
        cityObject = {
          id: newCity.id,
          name: newCity.name,
          nameLocal: newCity.nameLocal,
          countryCode: newCity.countryCode,
          coordinates: { x: newCity.lng, y: newCity.lat },
          approvedProjectCount: 0, // Not available from form context
          createdAt: new Date(),
          updatedAt: new Date(),
        };
      }
    }

    return cityObject;
  }

  // Handle local-only project updates (no backend submission)
  function handleLocalOnlyUpdate() {
    const currentProject = projectStore.projects[options.entityId];

    // Check if project exists in userContributions (for projects opened from ContributePanel)
    const userContributionProject = projectStore.userContributions.find(
      (p) => p.id === options.entityId,
    );

    if (!currentProject && !userContributionProject) {
      console.error("[useEditableProjectForm] PROJECT NOT FOUND AT ALL!");
      return;
    }

    const formFields = formDataToProjectFields(formData);

    // Update userContributions so ContributePanel shows updated data
    projectStore.updateProjectInUserContributions(options.entityId, formFields);

    // Update or create project in projectStore.projects for infopopup sync
    if (currentProject) {
      // Project exists in projects store - update it
      const cityObject = getCityObjectForUpdate(currentProject);
      projectStore.updateProject(options.entityId, {
        ...currentProject,
        ...formFields,
        city: cityObject,
        isModified: true,
      });

      const updatedProject = projectStore.projects[options.entityId];
      const hasNoOverlays = !updatedProject?.overlayIds || updatedProject.overlayIds.length === 0;
      if (updatedProject && hasNoOverlays) {
        updateStandaloneProjectMarkerColor(options.entityId, updatedProject);
      }
    } else if (userContributionProject) {
      // Project only exists in userContributions - add to projects store so infopopup finds it
      const projectFromContribution: Project = {
        ...createProjectFromUserContribution(userContributionProject),
        ...formFields,
        isModified: true,
      };

      // Add to projects store (updateProject handles creating new entries)
      projectStore.updateProject(options.entityId, projectFromContribution);
    }
  }

  // Handle pending project updates
  async function handlePendingProjectUpdate() {
    const result = await trpc.project.getUsersContributions.query({ limit: 100 });
    const project = result.projects.find((p) => p.id === options.entityId);

    if (!project) {
      throw new Error(t("errors.projectNotFound"));
    }

    const projectData = {
      id: options.entityId,
      name: formData.name,
      description: formData.description,
      cityId: project.cityId,
      lat: project.lat,
      lng: project.lng,
      timelineStatus: formData.timelineStatus ?? project.timelineStatus,
      proposalDate: formData.proposalDate,
      proposalDatePrecision: formData.proposalDate
        ? (formData.proposalDatePrecision ?? project.proposalDatePrecision)
        : null,
      startDate: formData.startDate,
      startDatePrecision: formData.startDate
        ? (formData.startDatePrecision ?? project.startDatePrecision)
        : null,
      endDate: formData.endDate,
      endDatePrecision: formData.endDate
        ? (formData.endDatePrecision ?? project.endDatePrecision)
        : null,
      sourceUrl: formData.sourceUrl,
      geometry: project.geometry ?? null,
      tags: formData.tags,
    };

    await trpc.project.publishProject.mutate(projectSchema.parse(projectData));

    toast.add({
      severity: "info",
      summary: t("moderation.projectUpdated"),
      detail: t("submission.changesSaved"),
      life: 3000,
    });
  }

  // Validate all form data using Zod schema
  function validateFormData(): boolean {
    // Get current project for lat/lng
    const currentProject = projectStore.projects[options.entityId];

    const validationData = prepareProjectValidationData(formData, {
      lat: currentProject?.lat,
      lng: currentProject?.lng,
    });

    const result = projectSchema.safeParse(validationData);

    if (!result.success) {
      const errors = getValidationErrorsMap(result.error);
      const firstError = Object.values(errors)[0];
      if (!firstError) return false;
      toast.add({
        severity: "error",
        summary: t("toast.validationError"),
        detail: t(firstError.key, firstError.params ?? {}),
        life: 3000,
      });
      return false;
    }

    return true;
  }

  // Submit changes with local-only handling and validation
  async function submitChanges() {
    if (!hasChanges.value) return;

    try {
      isSubmitting.value = true;

      if (!validateFormData()) return;

      if (options.localOnly) {
        handleLocalOnlyUpdate();
      } else {
        const changes = getChangesToSubmit();

        if (options.entityStatus === "pending") {
          await handlePendingProjectUpdate();
        } else {
          await handleApprovedEntityUpdate(changes);
        }
      }

      options.onSubmitted?.();
      options.onClose?.();
    } catch (error) {
      console.error("Failed to submit changes:", error);
      showErrorToast();
    } finally {
      isSubmitting.value = false;
    }
  }

  return {
    // State
    formData,
    originalData,
    changeReason,
    isSubmitting,

    // Computed
    hasChanges,

    // Methods
    hasChanged,
    resetChanges,
    getFieldClasses,
    showErrorToast,
    submitChanges,
  };
}
