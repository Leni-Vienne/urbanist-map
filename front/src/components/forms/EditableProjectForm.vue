<template>
  <div class="editable-project-form">
    <form @submit.prevent="submitChanges" class="project-form">
      <div class="form-group">
        <label for="name">Project Name *</label>
        <InputText
          id="name"
          v-model="formData.name"
          :class="{ 'field-changed': hasChanged('name') }"
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
          :class="{ 'field-changed': hasChanged('description') }"
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
          :class="{ 'field-changed': hasChanged('sourceUrl') }"
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
            :class="{ 'field-changed': hasChanged('startDate') }"
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
            :class="{ 'field-changed': hasChanged('endDate') }"
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
          :class="{ 'field-changed': hasChanged('latestUpdateOn') }"
          dateFormat="yy-mm-dd"
          placeholder="Select latest update date"
        />
        <small v-if="hasChanged('latestUpdateOn')" class="change-indicator">
          Changed from: "{{ formatDate(originalData.latestUpdateOn) || 'Not set' }}"
        </small>
      </div>

      <div class="form-group">
        <label for="changeReason">Reason for Changes</label>
        <Textarea
          id="changeReason"
          v-model="changeReason"
          rows="2"
          placeholder="Briefly explain why you're making these changes"
        />
      </div>

      <div class="form-actions">
        <Button
          v-if="hasChanges"
          type="button"
          @click="resetChanges"
          label="Reset"
          severity="secondary"
          outlined
          icon="pi pi-undo"
        />
        <Button
          type="button"
          @click="$emit('close')"
          label="Cancel"
          severity="secondary"
          outlined
        />
        <Button
          type="submit"
          :disabled="!hasChanges"
          :loading="isSubmitting"
          label="Submit Changes for Review"
          icon="pi pi-send"
        />
      </div>
    </form>

  </div>
</template>

<script setup lang="ts">
import { ref, computed, reactive } from 'vue'
import { useFieldChanges } from '../../composables/changes/useFieldChanges'
import { useToast } from '../../composables/ui/useToast'
import type { Project } from '../../types'

interface Props {
  project: Project
}

interface Emits {
  (e: 'close'): void
  (e: 'submitted'): void
}

const props = defineProps<Props>()
const emit = defineEmits<Emits>()

const { submitMultipleFieldChanges } = useFieldChanges()
const toast = useToast()

const isSubmitting = ref(false)
const changeReason = ref('')

const originalData = reactive({
  name: props.project.name,
  description: props.project.description || '',
  sourceUrl: props.project.sourceUrl || '',
  startDate: props.project.startDate,
  endDate: props.project.endDate,
  latestUpdateOn: props.project.latestUpdateOn,
})

const formData = reactive({
  name: props.project.name,
  description: props.project.description || '',
  sourceUrl: props.project.sourceUrl || '',
  startDate: props.project.startDate,
  endDate: props.project.endDate,
  latestUpdateOn: props.project.latestUpdateOn,
})

function hasChanged(fieldName: keyof typeof formData): boolean {
  const original = originalData[fieldName]
  const current = formData[fieldName]
  
  if (original instanceof Date && current instanceof Date) {
    return original.getTime() !== current.getTime()
  }
  
  return original !== current
}

const hasChanges = computed(() => {
  return Object.keys(formData).some(key => hasChanged(key as keyof typeof formData))
})

function resetChanges() {
  Object.assign(formData, originalData)
  changeReason.value = ''
}

function getChangesToSubmit() {
  const changes: Array<{
    fieldName: string
    oldValue: any
    newValue: any
  }> = []

  Object.keys(formData).forEach(key => {
    const fieldName = key as keyof typeof formData
    if (hasChanged(fieldName)) {
      changes.push({
        fieldName,
        oldValue: originalData[fieldName],
        newValue: formData[fieldName]
      })
    }
  })

  return changes
}

function formatValue(value: any): string {
  if (value === null || value === undefined || value === '') {
    return 'Not set'
  }
  if (value instanceof Date) {
    return value.toLocaleDateString()
  }
  return String(value)
}

function formatDate(date: Date | null | undefined): string {
  if (!date) return ''
  return date.toLocaleDateString()
}

async function submitChanges() {
  if (!hasChanges.value) return

  try {
    isSubmitting.value = true

    const changes = getChangesToSubmit().map(change => ({
      ...change,
      changeReason: changeReason.value || undefined
    }))

    await submitMultipleFieldChanges('project', props.project.id, changes)

    toast.add({
      severity: 'success',
      summary: 'Changes Submitted',
      detail: `${changes.length} change(s) submitted for moderation review`,
      life: 3000
    })

    emit('submitted')
    emit('close')
  } catch (error) {
    console.error('Failed to submit changes:', error)
    toast.add({
      severity: 'error',
      summary: 'Submission Failed',
      detail: 'Failed to submit changes. Please try again.',
      life: 3000
    })
  } finally {
    isSubmitting.value = false
  }
}
</script>

<style scoped>
.editable-project-form {
  padding: 1.5rem;
}

.project-form {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.form-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 1rem;
}

.form-group label {
  font-weight: 600;
  color: #374151;
  font-size: 0.875rem;
}

.form-group input,
.form-group textarea {
  width: 100%;
}

.field-changed {
  border-color: #f59e0b !important;
  background-color: #fffbeb !important;
}

.change-indicator {
  color: #92400e;
  font-style: italic;
  background: #fef3c7;
  padding: 0.25rem 0.5rem;
  border-radius: 4px;
  font-size: 0.75rem;
}

.form-actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.75rem;
  margin-top: 1.5rem;
  padding-top: 1rem;
  border-top: 1px solid #e5e7eb;
}

@media (max-width: 640px) {
  .form-row {
    grid-template-columns: 1fr;
  }
  
  .editable-project-form {
    padding: 1rem;
  }
  
  .form-actions {
    flex-direction: column-reverse;
  }
}
</style>