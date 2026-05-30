import { computed, reactive } from "vue";
import { formDataToProjectFields } from "@/utils/projectFormHelpers";
import { useProjectStore } from "@/stores/pinia/projectStore";
import { updateStandaloneProjectMarkerColor } from "@/services/map/standaloneProjectMarkers";
import { useToast } from "@/composables/ui/useToast";
import { t } from "@/locales";
import { getProjectValidationErrors } from "@/utils/validationHelpers";
import type { Project, ProjectFormData } from "@/types/index";
import type { DBCity } from "../../../../back/src/db/schema";

function fieldsDiffer(
  original: ProjectFormData[keyof ProjectFormData],
  current: ProjectFormData[keyof ProjectFormData],
): boolean {
  if (original instanceof Date && current instanceof Date) {
    return original.getTime() !== current.getTime();
  }

  if ((original instanceof Date && !current) || (!original && current instanceof Date)) {
    return true;
  }

  return original !== current;
}

interface EditableProjectFormOptions {
  entityId: string;
  initialData: ProjectFormData; // Original backend values for "modified from X" comparison
  currentData?: ProjectFormData; // Current values to display in form (if different from initialData after local saves)
  getAvailableCities?: () => {
    id: number;
    name: string;
    nameLocal: string | null;
    countryCode: string;
    lat: number;
    lng: number;
    distance?: number;
  }[];
  onSubmitted?: () => void;
  onClose?: () => void;
}

// Local-edit form for a project: edits are written to the store with isModified, then
// submitted to the backend later through the submission dialog (useSubmissionService).
export function useEditableProjectForm(options: EditableProjectFormOptions) {
  const projectStore = useProjectStore();
  const toast = useToast();

  // originalData is the comparison baseline; formData is what the user edits
  const originalData = reactive({ ...options.initialData }) as ProjectFormData;
  const formData = reactive({ ...(options.currentData ?? options.initialData) }) as ProjectFormData;

  function hasChanged(fieldName: keyof ProjectFormData): boolean {
    return fieldsDiffer(originalData[fieldName], formData[fieldName]);
  }

  const hasChanges = computed(() => {
    // oxlint-disable-next-line no-unsafe-type-assertion
    return Object.keys(formData).some((key) => hasChanged(key as keyof ProjectFormData));
  });

  function resetChanges() {
    Object.assign(formData, originalData);
  }

  function getFieldClasses(fieldName: keyof ProjectFormData) {
    return {
      "field-changed": hasChanged(fieldName),
    };
  }

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
          approvedProjectCount: 0,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
      }
    }

    return cityObject;
  }

  function applyLocalEdit() {
    const currentProject = projectStore.projects[options.entityId];

    const userContributionProject = projectStore.userContributions.find(
      (p) => p.id === options.entityId,
    );

    if (!currentProject && !userContributionProject) {
      console.error("[useEditableProjectForm] project not found:", options.entityId);
      return;
    }

    const formFields = formDataToProjectFields(formData);

    projectStore.updateProjectInUserContributions(options.entityId, formFields);

    if (currentProject) {
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
      // Not yet in projects store. UserContribution extends Project, so we can spread directly.
      const projectFromContribution: Project = {
        ...userContributionProject,
        ...formFields,
        isModified: true,
      };

      projectStore.updateProject(options.entityId, projectFromContribution);
    }
  }

  function validateFormData(): boolean {
    const currentProject = projectStore.projects[options.entityId];

    const errors = getProjectValidationErrors(formData, {
      lat: currentProject?.lat,
      lng: currentProject?.lng,
    });

    if (!errors) return true;

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

  function submitChanges() {
    if (!hasChanges.value) return;
    if (!validateFormData()) return;

    applyLocalEdit();
    options.onSubmitted?.();
    options.onClose?.();
  }

  return {
    formData,
    originalData,
    hasChanges,
    hasChanged,
    resetChanges,
    getFieldClasses,
    submitChanges,
  };
}
