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
import type { StagedRender } from "@/composables/submission/stagedRenderStore";

defineProps<{
  visible: boolean;
  project: Partial<Project>;
}>();

const emit = defineEmits<{
  "update:visible": [visible: boolean];
  submit: [project: Partial<Project>, render: StagedRender | null];
  cancel: [];
}>();

const projectFormRef = ref<InstanceType<typeof CreateProjectForm> | null>(null);

function handleVisibilityChange(newVisible: boolean) {
  emit("update:visible", newVisible);
}

function handleSubmit(project: Partial<Project>, render: StagedRender | null) {
  emit("submit", project, render);
}

function handleCancel() {
  emit("cancel");
  emit("update:visible", false);
}

function handleFormSubmit() {
  if (projectFormRef.value) {
    projectFormRef.value.handleSubmit();
  }
}
</script>
