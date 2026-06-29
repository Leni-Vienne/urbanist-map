<template>
  <div class="pt-0 p-6 max-sm:p-4">
    <form @submit.prevent="form.submitChanges" class="flex flex-col gap-4">
      <ProjectFormFields
        :form-data="form.formData"
        :original-data="form.originalData"
        :show-change-indicators="true"
        :timeline-status="timelineStatus"
        :field-classes="
          (fieldName: string) => form.getFieldClasses(fieldName as keyof ProjectFormData)
        "
        :has-changed="(fieldName: string) => form.hasChanged(fieldName as keyof ProjectFormData)"
        id-prefix="edit"
        @update:timeline-status="
          timelineStatus = $event;
          form.formData.timelineStatus = $event;
        "
        @update:form-data="Object.assign(form.formData, $event)"
      />

      <!-- Form actions -->
      <div
        class="flex flex-col-reverse sm:flex-row justify-end gap-3 mt-6 pt-4 border-t border-surface"
      >
        <Button
          v-if="form.hasChanges.value"
          type="button"
          @click="handleReset"
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
import type { Project, ProjectFormData } from "@/types/index";
import type { TimelineStatus } from "../../../../back/src/db/schema";
import { projectToFormData } from "@/utils/projectFormHelpers";

import ProjectFormFields from "@/components/forms/ProjectFormFields.vue";

const props = defineProps<{ project: Project }>();
const emit = defineEmits<{ close: []; submitted: [] }>();

const projectStore = useProjectStore();

const timelineStatus = ref<TimelineStatus>(props.project.timelineStatus ?? "proposed");

// Get original backend project if available (for comparison baseline)
// Uses centralized helper that checks both originalBackendProjects and originalUserContributions
const originalProject = computed(() => {
  return projectStore.getOriginalProject(props.project.id) ?? props.project;
});

const projectData = computed(() => projectToFormData(originalProject.value));
const currentProjectData = computed(() => {
  // Prefer the map store version if locally modified (updated by handleLocalOnlyUpdate)
  const storeProject = projectStore.projects[props.project.id];
  if (storeProject?.isModified) {
    return projectToFormData(storeProject);
  }
  // Fall back to originalProject (authoritative backend state) rather than props.project,
  // which may hold stale data from the userContributions cache
  return projectToFormData(originalProject.value);
});

const form = useEditableProjectForm({
  entityId: props.project.id,
  initialData: projectData.value, // Original backend values for comparison
  currentData: currentProjectData.value, // Current values to display in form
  getSourceProject: () => props.project,
  onSubmitted: () => emit("submitted"),
  onClose: () => emit("close"),
});

function handleReset() {
  form.resetChanges();
}
</script>
