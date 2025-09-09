<template>
  <div :class="containerClass">
    <form @submit.prevent="form.submitChanges" :class="formClass">
      <!-- AI : Fields slot where specific form fields are rendered -->
      <slot 
        name="fields" 
        :formData="form.formData"
        :originalData="form.originalData"
        :hasChanged="form.hasChanged"
        :getFieldClasses="form.getFieldClasses"
        :formatValue="form.formatValue"
        :formatDate="form.formatDate"
      />
      
      <!-- AI : Change reason field (shown conditionally) -->
      <div v-if="showChangeReason" class="form-group">
        <label for="changeReason">{{ $t('common.reasonForChanges') }}</label>
        <Textarea
          id="changeReason"
          v-model="form.changeReason.value"
          rows="2"
          :placeholder="$t('common.explainChanges')"
        />
      </div>

      <!-- AI : Form actions with configurable buttons -->
      <div class="form-actions">
        <Button
          v-if="form.hasChanges.value && showReset"
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
          :label="cancelLabel"
          severity="secondary"
          outlined
        />
        <Button
          type="submit"
          :disabled="!form.hasChanges.value"
          :loading="form.isSubmitting.value"
          :label="dynamicSubmitLabel"
          icon="pi pi-send"
        />
      </div>
    </form>
  </div>
</template>

<script setup lang="ts" generic="T extends Record<string, any>">
import { computed } from 'vue'
import { useEditableForm, type EditableFormOptions } from '@composables/forms/useEditableForm'

interface Props {
  entityType: 'project' | 'overlay'
  entityId: string
  initialData: T
  entityStatus?: 'pending' | 'approved' | 'rejected'
  containerClass?: string
  formClass?: string
  submitLabel?: string
  cancelLabel?: string
  showReset?: boolean
  showChangeReason?: boolean
}

interface Emits {
  (e: 'close'): void
  (e: 'submitted'): void
}

const props = withDefaults(defineProps<Props>(), {
  containerClass: 'base-editable-form',
  formClass: 'editable-form',
  submitLabel: '',
  cancelLabel: 'Cancel',
  showReset: true,
  showChangeReason: true
})

const emit = defineEmits<Emits>()

// AI : Create form instance with options
const formOptions: EditableFormOptions<T> = {
  entityType: props.entityType,
  entityId: props.entityId,
  initialData: props.initialData,
  entityStatus: props.entityStatus,
  onSubmitted: () => emit('submitted'),
  onClose: () => emit('close')
}

const form = useEditableForm(formOptions)

// AI : Dynamic submit label based on entity status
const dynamicSubmitLabel = computed(() => {
  if (props.submitLabel) return props.submitLabel
  return props.entityStatus === 'pending' ? 'Save Changes' : 'Submit Changes for Review'
})
</script>

<style>
.base-editable-form {
  padding: 1.5rem;
}

.editable-form {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
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

/* AI : Global field change styling */
:deep(.field-changed) {
  border-color: #f59e0b !important;
  background-color: #fffbeb !important;
}

/* AI : Change indicator styling */
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

/* AI : Reserve space for change indicators to prevent layout jumping */
.change-indicator-placeholder {
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
  .base-editable-form {
    padding: 1rem;
  }
  
  .form-actions {
    flex-direction: column-reverse;
  }
}
</style>