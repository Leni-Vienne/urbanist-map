<template>
  <BaseEditableForm
    entity-type="project"
    :entity-id="project.id"
    :initial-data="projectData"
    :entity-status="project.status"
    container-class="editable-project-form"
    form-class="project-form"
    @close="$emit('close')"
    @submitted="$emit('submitted')"
  >
    <template #fields="{ formData, originalData, hasChanged, getFieldClasses, formatDate }">
      <div class="form-group">
        <label for="name">Project Name *</label>
        <InputText
          id="name"
          v-model="formData.name"
          :class="getFieldClasses('name')"
          placeholder="Enter project name"
          required
        />
        <small v-if="hasChanged('name')" class="change-indicator">
          Changed from: "{{ originalData.name || 'Not set' }}"
        </small>
      </div>

      <div class="form-group">
        <label for="description">Description</label>
        <Textarea
          id="description"
          v-model="formData.description"
          :class="getFieldClasses('description')"
          rows="3"
          placeholder="Describe the construction project"
        />
        <small v-if="hasChanged('description')" class="change-indicator">
          Changed from: "{{ originalData.description || 'Not set' }}"
        </small>
      </div>

      <div class="form-group">
        <label for="sourceUrl">Source URL</label>
        <InputText
          id="sourceUrl"
          v-model="formData.sourceUrl"
          :class="getFieldClasses('sourceUrl')"
          placeholder="https://example.com/project-info"
        />
        <small v-if="hasChanged('sourceUrl')" class="change-indicator">
          Changed from: "{{ originalData.sourceUrl || 'Not set' }}"
        </small>
      </div>

      <div class="form-row">
        <div class="form-group">
          <label for="startDate">Start Date</label>
          <DatePicker
            id="startDate"
            v-model="formData.startDate"
            :class="getFieldClasses('startDate')"
            dateFormat="yy-mm-dd"
            placeholder="Select start date"
          />
          <small v-if="hasChanged('startDate')" class="change-indicator">
            Changed from: "{{ formatDate(originalData.startDate) || 'Not set' }}"
          </small>
        </div>

        <div class="form-group">
          <label for="endDate">End Date</label>
          <DatePicker
            id="endDate"
            v-model="formData.endDate"
            :class="getFieldClasses('endDate')"
            dateFormat="yy-mm-dd"
            placeholder="Select end date"
          />
          <small v-if="hasChanged('endDate')" class="change-indicator">
            Changed from: "{{ formatDate(originalData.endDate) || 'Not set' }}"
          </small>
        </div>
      </div>

      <div class="form-group">
        <label for="latestUpdateOn">Latest Update</label>
        <DatePicker
          id="latestUpdateOn"
          v-model="formData.latestUpdateOn"
          :class="getFieldClasses('latestUpdateOn')"
          dateFormat="yy-mm-dd"
          placeholder="Select latest update date"
        />
        <small v-if="hasChanged('latestUpdateOn')" class="change-indicator">
          Changed from: "{{ formatDate(originalData.latestUpdateOn) || 'Not set' }}"
        </small>
      </div>
    </template>
  </BaseEditableForm>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import BaseEditableForm from './BaseEditableForm.vue'
import type { Project } from '@types'

interface Props {
  project: Project
}

interface Emits {
  (e: 'close'): void
  (e: 'submitted'): void
}

const props = defineProps<Props>()
defineEmits<Emits>()

// AI : Transform project data for the form (include cityId to preserve it)
const projectData = computed(() => ({
  name: props.project.name,
  description: props.project.description || '',
  sourceUrl: props.project.sourceUrl || '',
  startDate: props.project.startDate,
  endDate: props.project.endDate,
  latestUpdateOn: props.project.latestUpdateOn,
  cityId: props.project.cityId, // AI : Include cityId to prevent it from being lost
}))
</script>

<style scoped>
/* AI : Project-specific form styling */
.form-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 1rem;
}

@media (max-width: 640px) {
  .form-row {
    grid-template-columns: 1fr;
  }
}
</style>