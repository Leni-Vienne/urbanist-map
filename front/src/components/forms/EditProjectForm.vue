<template>
  <div class="pt-0 p-6 max-sm:p-4">
    <form @submit.prevent="form.submitChanges" class="flex flex-col gap-4">
      <ProjectFormFields
        :form-data="form.formData"
        :original-data="form.originalData"
        :show-change-indicators="true"
        id-prefix="edit"
        @update:form-data="Object.assign(form.formData, $event)"
      />

      <!-- Form actions -->
      <div
        class="flex flex-col-reverse sm:flex-row justify-end gap-3 mt-6 pt-4 border-t border-surface"
      >
        <Button
          v-if="form.hasChanges.value"
          type="button"
          @click="handleReset"
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
          :disabled="!form.hasChanges.value"
          :label="$t('forms.saveChanges')"
          icon="pi pi-send"
        />
      </div>
    </form>
  </div>
</template>

<script setup lang="ts">
import { useEditableProjectForm } from "@/composables/forms/useEditableProjectForm";
import { useProjectStore } from "@/stores/projectStore";
import type { Project } from "@/types/index";
import { projectToFormData } from "@/utils/projectFormHelpers";

import ProjectFormFields from "@/components/forms/ProjectFormFields.vue";

const props = defineProps<{ project: Project }>();
const emit = defineEmits<{ close: []; submitted: [] }>();

const projectStore = useProjectStore();

// Comparison baseline for the diff sent to the backend: the authoritative backend snapshot rather
// than the project object captured when the form opened.
const originalProject = projectStore.getOriginalProject(props.project.id) ?? props.project;
const storeProject = projectStore.projects[props.project.id];

const form = useEditableProjectForm({
  entityId: props.project.id,
  initialData: projectToFormData(originalProject),
  // Displayed values: the map store version when locally modified.
  currentData: projectToFormData(storeProject?.isModified ? storeProject : originalProject),
  getSourceProject: () => props.project,
  onSubmitted: () => emit("submitted"),
  onClose: () => emit("close"),
});

function handleReset() {
  form.resetChanges();
}
</script>
