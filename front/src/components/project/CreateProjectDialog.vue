<template>
  <Dialog
    :visible="visible"
    :header="$t('dialog.createNewProject')"
    :modal="true"
    :closable="true"
    :draggable="false"
    :pt="{
      root: { class: 'w-[40rem] max-w-[92vw]' },
      content: { class: 'sm:overflow-y-auto sm:max-h-[70vh]' },
    }"
    @update:visible="handleVisibilityChange"
  >
    <template #default>
      <CreateProjectForm
        ref="projectFormRef"
        :project="project"
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
          :label="$t('project.create')"
          icon="pi pi-save"
          @click="handleFormSubmit"
        />
      </div>
    </template>
  </Dialog>
</template>

<script setup lang="ts">
import { ref } from "vue";
import type CreateProjectForm from "@/components/forms/CreateProjectForm.vue";
import type { Project } from "@/types/index";

defineProps<{
  visible: boolean;
  project: Partial<Project>;
}>();

const emit = defineEmits<{
  "update:visible": [visible: boolean];
  submit: [project: Partial<Project>];
  cancel: [];
}>();

const projectFormRef = ref<InstanceType<typeof CreateProjectForm> | null>(null);

// Handle dialog visibility changes
function handleVisibilityChange(newVisible: boolean) {
  emit("update:visible", newVisible);
}

// Handle form submission from ProjectForm
function handleSubmit(project: Partial<Project>) {
  emit("submit", project);
}

// Handle cancel from ProjectForm or dialog
function handleCancel() {
  emit("cancel");
  emit("update:visible", false);
}

// Handle submit button click in footer (trigger form validation)
function handleFormSubmit() {
  // Call the exposed handleSubmit method from ProjectForm
  if (projectFormRef.value) {
    projectFormRef.value.handleSubmit();
  }
}
</script>
