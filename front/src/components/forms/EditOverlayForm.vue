<template>
  <div class="editable-overlay-form">
    <form @submit.prevent="form.submitChanges" class="overlay-form">
      <div class="form-group">
        <label for="caption">{{ $t('overlay.overlayNameCaption') }}</label>
        <InputText
          id="caption"
          v-model="form.formData.caption"
          :class="form.getFieldClasses('caption')"
          :placeholder="$t('overlay.enterOverlayName')"
        />
        <small v-if="form.hasChanged('caption')" class="change-indicator">
          {{ $t('overlay.changedFrom') }}: "{{ form.originalData.caption || $t('overlay.notSet') }}"
        </small>
        <div v-else class="change-indicator-placeholder"></div>
      </div>

      <!-- Form actions -->
      <div class="form-actions">
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
import { computed } from 'vue'
import { useEditableOverlayForm } from '@composables/forms/useEditableOverlayForm'
import type { OverlayObject } from '@types'

interface Props {
  overlay: OverlayObject
}

interface Emits {
  (e: 'close'): void
  (e: 'submitted'): void
}

const props = defineProps<Props>()
const emit = defineEmits<Emits>()

// AI : Transform overlay data for the form
const overlayData = computed(() => ({
  caption: props.overlay.caption || '',
}))

const form = useEditableOverlayForm({
  entityId: props.overlay.id,
  initialData: overlayData.value,
  entityStatus: props.overlay.status,
  onSubmitted: () => emit('submitted'),
  onClose: () => emit('close')
})
</script>

<style scoped>
/* AI : Overlay-specific form styling */
.editable-overlay-form {
  min-height: 280px;
  display: flex;
  flex-direction: column;
  padding: 1.5rem;
}

.overlay-form {
  flex: 1;
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
  .editable-overlay-form {
    padding: 1rem;
  }

  .form-actions {
    flex-direction: column-reverse;
  }
}
</style>