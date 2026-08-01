import { computed, reactive } from "vue";
import { formDataToProjectFields, projectFormFieldsDiffer } from "@/utils/projectFormHelpers";
import { useProjectStore } from "@/stores/projectStore";
import { toastError } from "@/services/core/toast";
import { t } from "@/locales";
import { getProjectValidationErrors } from "@/utils/validationHelpers";
import type { Project, ProjectFormData } from "@/types/index";

interface EditableProjectFormOptions {
  entityId: string;
  initialData: ProjectFormData; // Original backend values for "modified from X" comparison
  currentData?: ProjectFormData; // Current values to display in form (if different from initialData after local saves)
  // Full project the form was opened with. Used to seed the store when the project
  // isn't already present (e.g. opened from a tile/moderation source, or evicted by clearAllState).
  getSourceProject?: () => Project | undefined;
  onSubmitted?: () => void;
  onClose?: () => void;
}

// Local-edit form for a project: edits are written to the store with isModified, then
// submitted to the backend later through the submission dialog (submissionService).
export function useEditableProjectForm(options: EditableProjectFormOptions) {
  const projectStore = useProjectStore();

  // originalData is the comparison baseline; formData is what the user edits
  const originalData = reactive({ ...options.initialData });
  const formData = reactive({ ...(options.currentData ?? options.initialData) });

  function fieldDiffersFromOriginal(fieldName: keyof ProjectFormData): boolean {
    return projectFormFieldsDiffer(originalData[fieldName], formData[fieldName]);
  }

  const hasChanges = computed(() => {
    // oxlint-disable-next-line no-unsafe-type-assertion
    return Object.keys(formData).some((key) =>
      fieldDiffersFromOriginal(key as keyof ProjectFormData),
    );
  });

  function resetChanges() {
    Object.assign(formData, originalData);
  }

  function applyLocalEdit() {
    // getSourceProject is the project the form was opened with, for sources not yet in the store.
    const baseProject: Project | undefined =
      projectStore.projects[options.entityId] ?? options.getSourceProject?.();

    if (!baseProject) {
      console.error("[useEditableProjectForm] project not found:", options.entityId);
      return;
    }

    const formFields = formDataToProjectFields(formData);

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
    toastError(t(firstError.key, firstError.params ?? {}), t("toast.validationError"));
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
    resetChanges,
    submitChanges,
  };
}
