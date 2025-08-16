<template>
  <div class="editable-overlay-form">
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
        <div v-else class="change-indicator-placeholder"></div>
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
  padding: 1.5rem;
  min-height: 280px;
  display: flex;
  flex-direction: column;
}

.overlay-form {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  flex: 1;
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
  min-height: 1.25rem;
  display: flex;
  align-items: center;
}

/* AI : Reserve space for change indicators to prevent dialog jumping */
.form-group {
  position: relative;
}

.form-group small.change-indicator,
.form-group .change-indicator-placeholder {
  min-height: 1.25rem;
  margin-top: 0.25rem;
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
  .editable-overlay-form {
    padding: 1rem;
  }
  
  .form-actions {
    flex-direction: column-reverse;
  }
}
</style>