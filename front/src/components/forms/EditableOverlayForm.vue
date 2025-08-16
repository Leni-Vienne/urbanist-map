<template>
  <div class="editable-overlay-form">
    <div class="form-header">
      <h3>Edit Overlay Information</h3>
      <div class="header-actions">
        <Button
          v-if="hasChanges"
          icon="pi pi-undo"
          @click="resetChanges"
          size="small"
          label="Reset"
          severity="secondary"
          text
        />
        <Button
          icon="pi pi-times"
          @click="$emit('close')"
          size="small"
          severity="secondary"
          text
        />
      </div>
    </div>

    <form @submit.prevent="submitChanges" class="overlay-form">
      <div class="form-group">
        <label for="caption">Overlay Name/Caption</label>
        <InputText
          id="caption"
          v-model="formData.caption"
          :class="{ 'field-changed': hasChanged('caption') }"
          placeholder="Enter overlay name or caption"
        />
        <small v-if="hasChanged('caption')" class="change-indicator">
          Changed from: "{{ originalData.caption || 'Not set' }}"
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

    <div v-if="hasChanges" class="changes-summary">
      <h4>Changes to be submitted:</h4>
      <ul>
        <li v-for="change in getChangesToSubmit()" :key="change.fieldName">
          <strong>{{ change.fieldName }}:</strong>
          "{{ formatValue(change.oldValue) }}" → "{{ formatValue(change.newValue) }}"
        </li>
      </ul>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, reactive, onMounted } from 'vue'
import { useFieldChanges } from '../../composables/changes/useFieldChanges'
import { useToast } from '../../composables/ui/useToast'
import InputText from 'primevue/inputtext'
import Textarea from 'primevue/textarea'
import Button from 'primevue/button'
import type { OverlayObject } from '../../types'

interface Props {
  overlay: OverlayObject
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
  caption: props.overlay.caption || '',
})

const formData = reactive({
  caption: props.overlay.caption || '',
})

function hasChanged(fieldName: keyof typeof formData): boolean {
  const original = originalData[fieldName]
  const current = formData[fieldName]
  
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
  if (typeof value === 'number') {
    return value.toFixed(6)
  }
  return String(value)
}

async function submitChanges() {
  if (!hasChanges.value) return

  try {
    isSubmitting.value = true

    const changes = getChangesToSubmit().map(change => ({
      ...change,
      changeReason: changeReason.value || undefined
    }))

    await submitMultipleFieldChanges('overlay', props.overlay.id, changes)

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
.editable-overlay-form {
  background: white;
  border-radius: 8px;
  padding: 1.5rem;
  max-width: 700px;
  margin: 0 auto;
}

.form-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 1.5rem;
  padding-bottom: 1rem;
  border-bottom: 1px solid #e5e7eb;
}

.form-header h3 {
  margin: 0;
  color: #374151;
  font-size: 1.25rem;
  font-weight: 600;
}

.header-actions {
  display: flex;
  gap: 0.5rem;
}

.overlay-form {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.form-group > label {
  font-weight: 600;
  color: #374151;
  font-size: 0.875rem;
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

.changes-summary {
  margin-top: 1.5rem;
  padding: 1rem;
  background: #f0f9ff;
  border: 1px solid #bae6fd;
  border-radius: 6px;
}

.changes-summary h4 {
  margin: 0 0 0.75rem 0;
  color: #0c4a6e;
  font-size: 0.875rem;
  font-weight: 600;
}

.changes-summary ul {
  margin: 0;
  padding-left: 1.25rem;
  color: #0c4a6e;
}

.changes-summary li {
  font-size: 0.875rem;
  margin-bottom: 0.25rem;
}

@media (max-width: 640px) {
  .editable-overlay-form {
    padding: 1rem;
  }
  
  .form-actions {
    flex-direction: column-reverse;
  }
}
</style>