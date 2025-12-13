<template>
  <Dialog
    v-model:visible="isVisible"
    modal
    :header="$t('moderation.confirmRejection')"
    :style="{ width: '450px' }"
    @update:visible="handleVisibilityChange"
  >
    <!-- AI : Confirmation message -->
    <p class="rejection-message">{{ $t('moderation.confirmRejectionMessage') }}</p>

    <!-- AI : Report user checkbox (only show if userId is provided) -->
    <div v-if="userId" class="report-section">
      <div class="report-checkbox">
        <Checkbox v-model="reportUser" input-id="report-user" :binary="true" />
        <label for="report-user" class="report-label">
          {{ $t('moderation.reportUser.report') }}
        </label>
      </div>

      <!-- AI : Report reason field (only visible when checkbox is checked) -->
      <div v-if="reportUser" class="report-reason">
        <label for="report-reason">{{ $t('moderation.reportUser.reason') }}</label>
        <Textarea
          id="report-reason"
          v-model="reportReason"
          :placeholder="$t('moderation.reportUser.reasonPlaceholder')"
          rows="3"
          auto-resize
          class="report-textarea"
        />
      </div>
    </div>

    <template #footer>
      <div class="dialog-footer">
        <Button :label="$t('common.cancel')" severity="secondary" @click="handleCancel" />
        <Button
          :label="$t('moderation.reject')"
          severity="danger"
          icon="pi pi-times"
          :loading="isLoading"
          @click="handleConfirm"
        />
      </div>
    </template>
  </Dialog>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import Checkbox from 'primevue/checkbox'
import Textarea from 'primevue/textarea'

// AI : Props
interface Props {
  visible: boolean
  userId?: string | null
  isLoading?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  userId: null,
  isLoading: false
})

// AI : Emits
const emit = defineEmits<{
  'update:visible': [value: boolean]
  'confirm': [options: { reportUser: boolean; reportReason: string }]
  'cancel': []
}>()

// AI : Local state
const isVisible = ref(props.visible)
const reportUser = ref(false)
const reportReason = ref('')

// AI : Watch for external visibility changes
watch(() => props.visible, (newValue) => {
  isVisible.value = newValue
  // AI : Reset state when dialog opens
  if (newValue) {
    reportUser.value = false
    reportReason.value = ''
  }
})

// AI : Handle visibility change from dialog
function handleVisibilityChange(value: boolean) {
  emit('update:visible', value)
  if (!value) {
    emit('cancel')
  }
}

// AI : Handle cancel button
function handleCancel() {
  emit('update:visible', false)
  emit('cancel')
}

// AI : Handle confirm button
function handleConfirm() {
  emit('confirm', {
    reportUser: reportUser.value,
    reportReason: reportReason.value
  })
}
</script>

<style scoped>
.rejection-message {
  margin: 0 0 1rem 0;
  color: var(--p-surface-700);
}

.report-section {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  padding: 1rem;
  background-color: var(--p-surface-50);
  border-radius: 0.375rem;
  border: 1px solid var(--p-surface-200);
}

.report-checkbox {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.report-label {
  cursor: pointer;
  font-weight: 500;
  color: var(--p-surface-800);
}

.report-reason {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.report-reason label {
  font-size: 0.875rem;
  font-weight: 500;
  color: var(--p-surface-700);
}

.report-textarea {
  width: 100%;
}

.dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: 0.75rem;
}
</style>
