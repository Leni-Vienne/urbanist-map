<template>
  <div class="pt-0 p-6 max-sm:p-4">
    <form @submit.prevent="submitChanges" class="flex flex-col gap-4" novalidate>
      <ProjectFormFields
        :form-data="formData"
        :original-data="originalData"
        id-prefix="edit"
        @update:form-data="Object.assign(formData, $event)"
      />

      <div
        class="flex flex-col-reverse sm:flex-row justify-end gap-3 mt-6 pt-4 border-t border-surface"
      >
        <Button
          v-if="differsFromOriginal"
          type="button"
          @click="Object.assign(formData, originalData)"
          :label="$t('common.reset')"
          severity="secondary"
          outlined
          icon="pi pi-undo"
        />
        <Button
          type="button"
          @click="$emit('close')"
          :label="$t('common.cancel')"
          severity="secondary"
          outlined
        />
        <Button
          type="submit"
          :disabled="!hasChanges"
          :label="$t('forms.saveChanges')"
          icon="pi pi-send"
        />
      </div>
    </form>
  </div>
</template>

<script setup lang="ts">
import { computed, reactive } from "vue";
import { t } from "@/locales";
import { useProjectStore } from "@/stores/projectStore";
import { toastError } from "@/services/core/toast";
import {
  getProjectValidationErrors,
  getProjectEditValidationErrors,
} from "@/utils/validationHelpers";
import type { Project, ProjectFormData } from "@/types/index";
import { projectToFormData, projectFormFieldsDiffer } from "@/utils/projectFormHelpers";

import ProjectFormFields from "@/components/forms/ProjectFormFields.vue";

const props = defineProps<{ project: Project }>();
const emit = defineEmits<{ close: [] }>();

const projectStore = useProjectStore();

// Comparison baseline for the diff sent to the backend: the authoritative backend snapshot rather
// than the project object captured when the form opened.
const originalProject = projectStore.getPersistedProject(props.project.id) ?? props.project;
const storeProject = projectStore.projects[props.project.id];

const originalData = reactive(projectToFormData(originalProject));
const formData = reactive(projectToFormData(storeProject ?? originalProject));
const initialData = projectToFormData(storeProject ?? originalProject);
// oxlint-disable-next-line no-unsafe-type-assertion
const fields = Object.keys(formData) as (keyof ProjectFormData)[];

function fieldDiffersFromOriginal(field: keyof ProjectFormData): boolean {
  return projectFormFieldsDiffer(originalData[field], formData[field]);
}

const differsFromOriginal = computed(() => fields.some(fieldDiffersFromOriginal));
const hasChanges = computed(() =>
  fields.some((field) => projectFormFieldsDiffer(initialData[field], formData[field])),
);

function submitChanges() {
  if (!hasChanges.value) return;

  const projectId = props.project.id;
  const currentProject = projectStore.getProjectById(projectId);
  if (!currentProject) return;
  const patch: Partial<ProjectFormData> = {};
  for (const field of fields) {
    if (fieldDiffersFromOriginal(field)) Object.assign(patch, { [field]: formData[field] });
  }
  const errors =
    props.project.status === null
      ? getProjectValidationErrors(formData, { lat: currentProject?.lat, lng: currentProject?.lng })
      : getProjectEditValidationErrors(patch, originalData);
  if (errors) {
    const firstError = errors[0];
    if (firstError)
      toastError(t(firstError.key, firstError.params ?? {}), t("toast.validationError"));
    return;
  }

  for (const field of fields) {
    if (!fieldDiffersFromOriginal(field)) projectStore.resetProjectField(projectId, field);
  }
  projectStore.updateProjectDraft(projectId, patch);

  emit("close");
}
</script>
