<template>
  <BaseEditForm
    entity-type="project"
    :entity-id="project.id"
    :initial-data="projectData"
    :entity-status="project.status"
    :local-only="true"
    :get-available-cities="() => formFieldsRef?.cities ?? []"
    container-class="editable-project-form"
    form-class="project-form"
    :submit-label="$t('forms.saveChanges')"
    @close="$emit('close')"
    @submitted="$emit('submitted')"
  >
    <template #fields="{ formData, originalData, hasChanged, getFieldClasses }">
      <ProjectFormFields
        ref="formFieldsRef"
        :form-data="formData"
        :original-data="originalData"
        :show-change-indicators="true"
        :show-latest-update-field="true"
        :is-proposed="isProposed"
        :prefilled-city="project.city"
        :marker-coordinates="markerCoordinates"
        :field-classes="(n: string) => getFieldClasses(n as any)"
        :has-changed="(n: string) => hasChanged(n as any)"
        id-prefix="edit"
        @update:is-proposed="isProposed = $event"
      />
    </template>
  </BaseEditForm>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import BaseEditForm from './BaseEditForm.vue'
import ProjectFormFields from './ProjectFormFields.vue'
import type { Project } from '@types'

const props = defineProps<{ project: Project }>()
defineEmits<{ close: [], submitted: [] }>()

const formFieldsRef = ref<InstanceType<typeof ProjectFormFields> | null>(null)

const markerCoordinates = props.project.lat && props.project.lng
  ? { lat: props.project.lat, lng: props.project.lng }
  : null

const isProposed = ref(!!(props.project.proposalDate && !props.project.startDate && !props.project.endDate))

// AI : Helper to ensure dates are Date objects
function toDateObject(value: Date | string | null | undefined): Date | null {
  if (!value) return null
  if (value instanceof Date) return value
  const date = new Date(value)
  return isNaN(date.getTime()) ? null : date
}

const projectData = computed(() => ({
  name: props.project.name,
  description: props.project.description || '',
  sourceUrl: props.project.sourceUrl || '',
  proposalDate: toDateObject(props.project.proposalDate),
  startDate: toDateObject(props.project.startDate),
  endDate: toDateObject(props.project.endDate),
  latestUpdateOn: toDateObject(props.project.latestUpdateOn),
  cityId: props.project.cityId,
}))
</script>