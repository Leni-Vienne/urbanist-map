<template>
  <form @submit.prevent="handleSubmit" class="flex flex-col gap-4">
    <ProjectFormFields
      :form-data="formData"
      id-prefix="create"
      @update:form-data="Object.assign(formData, $event)"
    />
  </form>
</template>

<script setup lang="ts">
import { reactive } from "vue";
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

const emit = defineEmits<{
  submit: [project: Partial<Project>];
}>();

function handleSubmit() {
  const errors = getScopedProjectValidationErrors(formData);
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
  };

  emit("submit", result);
}

defineExpose({ handleSubmit });
</script>
