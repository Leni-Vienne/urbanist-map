<template>
  <Dialog
    :visible="true"
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
      <CreateProjectForm ref="projectFormRef" :project="project" @submit="handleSubmit" />
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
import CreateProjectForm from "@/components/forms/CreateProjectForm.vue";
import type { Project } from "@/types/index";

defineProps<{
  project: Partial<Project>;
}>();

const emit = defineEmits<{
  submit: [project: Partial<Project>];
  close: [];
}>();

const projectFormRef = ref<InstanceType<typeof CreateProjectForm> | null>(null);

function handleVisibilityChange(newVisible: boolean) {
  if (!newVisible) emit("close");
}

function handleSubmit(project: Partial<Project>) {
  emit("submit", project);
}

function handleCancel() {
  emit("close");
}

function handleFormSubmit() {
  if (projectFormRef.value) {
    projectFormRef.value.handleSubmit();
  }
}
</script>
