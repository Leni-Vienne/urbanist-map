<template>
  <Dialog
    :visible="visible"
    :header="dialogTitle"
    :modal="true"
    :closable="true"
    :draggable="false"
    @update:visible="handleVisibilityChange"
  >
    <template #default>
      <CreateProjectForm
        ref="projectFormRef"
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
          :label="$t('common.cancel')"
          severity="secondary"
          icon="pi pi-times"
          @click="handleCancel"
        />
        <Button
          type="button"
          :label="mode === 'create' ? $t('project.create') : $t('common.save')"
          icon="pi pi-save"
          @click="handleFormSubmit"
        />
      </div>
    </template>
  </Dialog>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import CreateProjectForm from '@components/forms/CreateProjectForm.vue';
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

const projectFormRef = ref<InstanceType<typeof CreateProjectForm> | null>(null);

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
  // AI : Call the exposed handleSubmit method from ProjectForm
  if (projectFormRef.value) {
    projectFormRef.value.handleSubmit();
  }
}
</script>
