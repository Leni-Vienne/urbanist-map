<template>
  <form @submit.prevent="handleSubmit" class="flex flex-col gap-4">
    <ProjectFormFields
      :form-data="formData"
      :timeline-status="timelineStatus"
      id-prefix="create"
      @update:timeline-status="timelineStatus = $event"
      @update:form-data="Object.assign(formData, $event)"
    />
  </form>
</template>

<script setup lang="ts">
import { ref, watch, reactive } from "vue";
import { validateProjectForm } from "@/utils/validationHelpers";
import type { Project, ProjectFormData } from "@/types/index";
import { projectToFormData, formDataToProjectFields } from "@/utils/projectFormHelpers";

import ProjectFormFields from "@/components/forms/ProjectFormFields.vue";

const props = defineProps<{
  project: Partial<Project>;
}>();

const formData = reactive<ProjectFormData>(projectToFormData(props.project));

const timelineStatus = ref<
  "proposed" | "planned" | "under_construction" | "completed" | "canceled"
>("proposed");

const emit = defineEmits<{
  submit: [project: Partial<Project>];
}>();

watch(
  () => props.project,
  (p) => Object.assign(formData, projectToFormData(p)),
  { deep: true },
);

function handleSubmit() {
  if (!validateProjectForm(formData, timelineStatus.value)) return;

  const result: Partial<Project> = {
    ...props.project,
    ...formDataToProjectFields(formData),
    timelineStatus: timelineStatus.value,
  };

  emit("submit", result);
}

defineExpose({ handleSubmit });
</script>
