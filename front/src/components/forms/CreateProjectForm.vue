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
import { ref, reactive } from "vue";
import { useI18n } from "vue-i18n";
import { getScopedProjectValidationErrors } from "@/utils/validationHelpers";
import { toastError } from "@/services/core/toast";
import type { Project, ProjectFormData } from "@/types/index";
import { projectToFormData, formDataToProjectFields } from "@/utils/projectFormHelpers";

import ProjectFormFields from "@/components/forms/ProjectFormFields.vue";

const { t } = useI18n();

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

function handleSubmit() {
  const errors = getScopedProjectValidationErrors(formData, timelineStatus.value);
  if (errors) {
    const firstError = Object.values(errors)[0];
    if (firstError) {
      toastError(t(firstError.key, firstError.params ?? {}), t("toast.validationError"));
    }
    return;
  }

  const result: Partial<Project> = {
    ...props.project,
    ...formDataToProjectFields(formData),
    timelineStatus: timelineStatus.value,
  };

  emit("submit", result);
}

defineExpose({ handleSubmit });
</script>
