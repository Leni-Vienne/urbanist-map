import { computed, reactive } from "vue";
import { formDataToProjectFields } from "@/utils/projectFormHelpers";
import { useProjectStore } from "@/stores/projectStore";
import { useToast } from "@/composables/ui/useToast";
import { t } from "@/locales";
import { getProjectValidationErrors } from "@/utils/validationHelpers";
import type { Project, ProjectFormData } from "@/types/index";

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
  // Full project the form was opened with. Used to seed the store when the project
  // isn't already present (e.g. opened from a tile/moderation source, or evicted by clearAllState).
  getSourceProject?: () => Project | undefined;
  // Extra dirtiness beyond the scalar form fields (e.g. a staged render image).
  extraDirty?: () => boolean;
  onSubmitted?: () => void;
  onClose?: () => void;
}

// Local-edit form for a project: edits are written to the store with isModified, then
// submitted to the backend later through the submission dialog (submissionService).
export function useEditableProjectForm(options: EditableProjectFormOptions) {
  const projectStore = useProjectStore();
  const toast = useToast();

  // originalData is the comparison baseline; formData is what the user edits
  const originalData = reactive({ ...options.initialData });
  const formData = reactive({ ...(options.currentData ?? options.initialData) });

  function hasChanged(fieldName: keyof ProjectFormData): boolean {
    return fieldsDiffer(originalData[fieldName], formData[fieldName]);
  }

  const hasChanges = computed(() => {
    if (options.extraDirty?.()) return true;
    // oxlint-disable-next-line no-unsafe-type-assertion
    return Object.keys(formData).some((key) => hasChanged(key as keyof ProjectFormData));
  });

  function resetChanges() {
    Object.assign(formData, originalData);
  }

  function applyLocalEdit() {
    // Each source resolves to a Project, so any of them can serve as the spread base.
    // getSourceProject is the project the form was opened with, for sources not yet in the store.
    const baseProject: Project | undefined =
      projectStore.projects[options.entityId] ??
      projectStore.userContributions[options.entityId] ??
      options.getSourceProject?.();

    if (!baseProject) {
      console.error("[useEditableProjectForm] project not found:", options.entityId);
      return;
    }

    const formFields = formDataToProjectFields(formData);

    projectStore.updateProjectInUserContributions(options.entityId, formFields);

    projectStore.updateProject(options.entityId, {
      ...baseProject,
      ...formFields,
      isModified: true,
    });
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
    submitChanges,
  };
}
