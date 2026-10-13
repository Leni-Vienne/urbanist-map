<template>
  <div class="pt-0 p-6 max-sm:p-4">
    <form @submit.prevent="submitChanges" class="flex flex-col gap-4">
      <ProjectFormFields
        :form-data="formData"
        :original-data="originalData"
        :show-change-indicators="true"
        id-prefix="edit"
        @update:form-data="Object.assign(formData, $event)"
      />

      <!-- Form actions -->
      <div
        class="flex flex-col-reverse sm:flex-row justify-end gap-3 mt-6 pt-4 border-t border-surface"
      >
        <Button
          v-if="hasChanges"
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
import { getProjectValidationErrors } from "@/utils/validationHelpers";
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
// oxlint-disable-next-line no-unsafe-type-assertion
const fields = Object.keys(formData) as (keyof ProjectFormData)[];

function fieldDiffersFromOriginal(field: keyof ProjectFormData): boolean {
  return projectFormFieldsDiffer(originalData[field], formData[field]);
}

const hasChanges = computed(() => fields.some(fieldDiffersFromOriginal));

function submitChanges() {
  if (!hasChanges.value) return;

  const projectId = props.project.id;
  const currentProject = projectStore.getProjectById(projectId);
  const errors = getProjectValidationErrors(formData, {
    lat: currentProject?.lat,
    lng: currentProject?.lng,
  });
  if (errors) {
    const firstError = errors[0];
    if (firstError)
      toastError(t(firstError.key, firstError.params ?? {}), t("toast.validationError"));
    return;
  }

  // The store may have been cleared while the form was open; seed it from the source project.
  if (!currentProject) {
    if (props.project.status === null) projectStore.addLocalProject(props.project);
    else projectStore.upsertProjectSummary(props.project);
  }

  const changedFields: Partial<Project> = {};
  for (const field of fields) {
    if (fieldDiffersFromOriginal(field)) {
      Object.assign(changedFields, { [field]: formData[field] });
    } else {
      projectStore.resetProjectField(projectId, field);
    }
  }
  projectStore.updateProjectDraft(projectId, changedFields);

  emit("close");
}
</script>
