<template>
  <BaseEditForm
    entity-type="overlay"
    :entity-id="overlay.id"
    :initial-data="overlayData"
    :entity-status="overlay.status"
    container-class="editable-overlay-form"
    form-class="overlay-form"
    @close="$emit('close')"
    @submitted="$emit('submitted')"
  >
    <template #fields="{ formData, originalData, hasChanged, getFieldClasses }">
      <div class="form-group">
        <label for="caption">{{ $t('overlay.overlayNameCaption') }}</label>
        <InputText
          id="caption"
          v-model="formData.caption"
          :class="getFieldClasses('caption')"
          :placeholder="$t('overlay.enterOverlayName')"
        />
        <small v-if="hasChanged('caption')" class="change-indicator">
          {{ $t('overlay.changedFrom') }}: "{{ originalData.caption || $t('overlay.notSet') }}"
        </small>
        <div v-else class="change-indicator-placeholder"></div>
      </div>
    </template>
  </BaseEditForm>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import BaseEditForm from './BaseEditForm.vue'
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

</style>