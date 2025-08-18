<template>
  <BaseEditableForm
    entity-type="overlay"
    :entity-id="overlay.id"
    :initial-data="overlayData"
    container-class="editable-overlay-form"
    form-class="overlay-form"
    @close="$emit('close')"
    @submitted="$emit('submitted')"
  >
    <template #fields="{ formData, originalData, hasChanged, getFieldClasses }">
      <div class="form-group">
        <label for="caption">Overlay Name/Caption</label>
        <InputText
          id="caption"
          v-model="formData.caption"
          :class="getFieldClasses('caption')"
          placeholder="Enter overlay name or caption"
        />
        <small v-if="hasChanged('caption')" class="change-indicator">
          Changed from: "{{ originalData.caption || 'Not set' }}"
        </small>
        <div v-else class="change-indicator-placeholder"></div>
      </div>
    </template>
  </BaseEditableForm>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import BaseEditableForm from './BaseEditableForm.vue'
import type { OverlayObject } from '@types'

interface Props {
  overlay: OverlayObject
}

interface Emits {
  (e: 'close'): void
  (e: 'submitted'): void
}

const props = defineProps<Props>()
defineEmits<Emits>()

// AI : Transform overlay data for the form
const overlayData = computed(() => ({
  caption: props.overlay.caption || '',
}))
</script>

<style scoped>
/* AI : Overlay-specific form styling */
.editable-overlay-form {
  min-height: 280px;
  display: flex;
  flex-direction: column;
}

.overlay-form {
  flex: 1;
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
</style>