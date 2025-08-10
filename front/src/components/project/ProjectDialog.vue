<template>
  <Dialog
    :visible="visible"
    :header="dialogTitle"
    :modal="true"
    :closable="true"
    :draggable="false"
    class="project-dialog"
    @update:visible="handleVisibilityChange"
  >
    <template #default>
      <ProjectForm
        :project="project"
        :mode="mode"
        @submit="handleSubmit"
        @cancel="handleCancel"
      />
    </template>

    <template #footer>
      <div class="flex gap-2 justify-end">
        <Button
          type="button"
          label="Cancel"
          severity="secondary"
          icon="pi pi-times"
          @click="handleCancel"
        />
        <Button
          type="button"
          :label="mode === 'create' ? 'Create Project' : 'Update Project'"
          icon="pi pi-save"
          @click="handleFormSubmit"
        />
      </div>
    </template>
  </Dialog>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import Dialog from 'primevue/dialog';
import Button from 'primevue/button';
import ProjectForm from './ProjectForm.vue';
import type { Project } from '@types';

const props = defineProps<{
  visible: boolean;
  project: Partial<Project>;
  mode: 'edit' | 'create';
  title?: string;
}>();

const emit = defineEmits<{
  'update:visible': [visible: boolean];
  submit: [project: Partial<Project>];
  cancel: [];
}>();

// AI : Reference to the form component to trigger validation
const projectFormRef = ref<InstanceType<typeof ProjectForm> | null>(null);

// AI : Computed dialog title with fallback
const dialogTitle = computed(() => {
  if (props.title) return props.title;
  return props.mode === 'create' ? 'Create New Project' : 'Edit Project';
});

// AI : Handle dialog visibility changes
function handleVisibilityChange(newVisible: boolean) {
  emit('update:visible', newVisible);
}

// AI : Handle form submission from ProjectForm
function handleSubmit(project: Partial<Project>) {
  emit('submit', project);
}

// AI : Handle cancel from ProjectForm or dialog
function handleCancel() {
  emit('cancel');
  emit('update:visible', false);
}

// AI : Handle submit button click in footer (trigger form validation)
function handleFormSubmit() {
  // AI : This will trigger the form's submit event if validation passes
  const formElement = document.querySelector('.project-dialog form');
  if (formElement instanceof HTMLFormElement) {
    formElement.requestSubmit();
  }
}
</script>

<style scoped>
.project-dialog {
  min-width: 500px;
  max-width: 600px;
}

@media (max-width: 768px) {
  .project-dialog {
    min-width: 90vw;
    max-width: 90vw;
  }
}
</style>