<template>
  <div class="p-6 max-sm:p-4">
    <form @submit.prevent="form.submitChanges" class="flex flex-col gap-4">
      <ProjectFormFields
        ref="formFieldsRef"
        :form-data="form.formData"
        :original-data="form.originalData"
        :show-change-indicators="true"
        :show-latest-update-field="true"
        :is-proposed="isProposed"
        :prefilled-city="project.city"
        :marker-coordinates="markerCoordinates"
        :field-classes="
          (fieldName: string) => form.getFieldClasses(fieldName as keyof ProjectFormData)
        "
        :has-changed="(fieldName: string) => form.hasChanged(fieldName as keyof ProjectFormData)"
        id-prefix="edit"
        @update:is-proposed="isProposed = $event"
        @update:form-data="Object.assign(form.formData, $event)"
      />

      <!-- Form actions -->
      <div
        class="flex flex-col-reverse sm:flex-row justify-end gap-3 mt-6 pt-4 border-t border-surface"
      >
        <Button
          v-if="form.hasChanges.value"
          type="button"
          @click="form.resetChanges"
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
          :loading="form.isSubmitting.value"
          :label="$t('forms.saveChanges')"
          icon="pi pi-send"
        />
      </div>
    </form>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { useEditableProjectForm } from "@/composables/forms/useEditableProjectForm";
import { useProjectStore } from "@/stores/pinia/projectStore";
import type ProjectFormFields from "@/components/forms/ProjectFormFields.vue";
import type { Project, ProjectFormData } from "@/types/index";
import { projectToFormData } from "@/utils/projectFormHelpers";

const props = defineProps<{ project: Project }>();
const emit = defineEmits<{ close: []; submitted: [] }>();

const projectStore = useProjectStore();
const formFieldsRef = ref<InstanceType<typeof ProjectFormFields> | null>(null);

const markerCoordinates =
  props.project.lat && props.project.lng
    ? { lat: props.project.lat, lng: props.project.lng }
    : null;

const isProposed = ref(
  Boolean(props.project.proposalDate && !props.project.startDate && !props.project.endDate),
);

// Get original backend project if available (for comparison baseline)
// Uses centralized helper that checks both originalBackendProjects and originalUserContributions
const originalProject = computed(() => {
  return projectStore.getOriginalProject(props.project.id) ?? props.project;
});

const projectData = computed(() => projectToFormData(originalProject.value));
const currentProjectData = computed(() => projectToFormData(props.project));

const form = useEditableProjectForm({
  entityId: props.project.id,
  initialData: projectData.value, // Original backend values for comparison
  currentData: currentProjectData.value, // Current values to display in form
  entityStatus: props.project.status,
  localOnly: true, // Save changes locally only, submit via dedicated "Submit Change Request" buttons
  getAvailableCities: () => formFieldsRef.value?.cities ?? [],
  onSubmitted: () => emit("submitted"),
  onClose: () => emit("close"),
});
</script>
