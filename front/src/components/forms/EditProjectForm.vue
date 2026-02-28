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
        class="flex flex-col-reverse sm:flex-row justify-end gap-3 mt-6 pt-4 border-t border-[var(--p-surface-200)]"
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

// AI : Helper to ensure dates are Date objects
function toDateObject(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  if (value instanceof Date) return value;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

// AI : Get original backend project if available (for comparison baseline)
// AI : Uses centralized helper that checks both originalBackendProjects and originalUserContributions
const originalProject = computed(() => {
  return projectStore.getOriginalProject(props.project.id) ?? props.project;
});

// AI : Use original backend values as the comparison baseline for "modified from X" indicators
const projectData = computed(() => ({
  name: originalProject.value.name,
  description: originalProject.value.description || "",
  sourceUrl: originalProject.value.sourceUrl || "",
  proposalDate: toDateObject(originalProject.value.proposalDate),
  proposalDatePrecision: originalProject.value.proposalDatePrecision ?? null,
  startDate: toDateObject(originalProject.value.startDate),
  startDatePrecision: originalProject.value.startDatePrecision ?? null,
  endDate: toDateObject(originalProject.value.endDate),
  endDatePrecision: originalProject.value.endDatePrecision ?? null,
  cityId: originalProject.value.cityId,
}));

// AI : Use current project values for the form's initial state (what user will see and edit)
const currentProjectData = computed(() => ({
  name: props.project.name,
  description: props.project.description || "",
  sourceUrl: props.project.sourceUrl || "",
  proposalDate: toDateObject(props.project.proposalDate),
  proposalDatePrecision: props.project.proposalDatePrecision ?? null,
  startDate: toDateObject(props.project.startDate),
  startDatePrecision: props.project.startDatePrecision ?? null,
  endDate: toDateObject(props.project.endDate),
  endDatePrecision: props.project.endDatePrecision ?? null,
  cityId: props.project.cityId,
}));

const form = useEditableProjectForm({
  entityId: props.project.id,
  initialData: projectData.value, // AI : Original backend values for comparison
  currentData: currentProjectData.value, // AI : Current values to display in form
  entityStatus: props.project.status,
  localOnly: true, // AI : Save changes locally only, submit via dedicated "Submit Change Request" buttons
  getAvailableCities: () => formFieldsRef.value?.cities ?? [],
  onSubmitted: () => emit("submitted"),
  onClose: () => emit("close"),
});
</script>
