<template>
  <Dialog
    v-model:visible="isVisible"
    modal
    :header="$t('submission.confirmTitle')"
    :style="{ width: '600px' }"
    @update:visible="handleVisibilityChange"
  >
    <div v-if="summary" class="submission-summary">
      <!-- Entity Information -->
      <div class="entity-info">
        <strong>{{ summary.entityName }}</strong>
        <Tag
          :severity="summary.requiresModeration ? 'warn' : 'success'"
          :value="summary.requiresModeration ? $t('submission.requiresModeration') : $t('submission.immediateUpdate')"
        />
      </div>

      <!-- Changes List -->
      <div v-if="summary.changes.length > 0" class="changes-section">
        <div class="changes-list">
          <div v-for="(change, index) in summary.changes" :key="index" class="change-item">
            <!-- AI : Header row with thumbnail (for overlays), label, and delete button -->
            <div class="change-header">
              <div class="change-thumbnail-row">
                <img
                  v-if="change.thumbnailUrl"
                  :src="change.thumbnailUrl"
                  :alt="change.displayLabel"
                  class="change-thumbnail"
                  @error="handleImageError"
                />
                <div class="field-label">{{ change.displayLabel }}</div>
              </div>
              <!-- AI : Delete button for all changes -->
              <Button
                icon="pi pi-times"
                severity="danger"
                text
                rounded
                class="delete-change-btn"
                @click="handleRemoveChange(index, change.field, change.overlayId)"
                v-tooltip.top="$t('submission.removeChange')"
              />
            </div>

            <div class="change-diff">
              <span class="value-text old-value">{{ change.oldValue }}</span>
              <i class="pi pi-arrow-right"></i>
              <span class="value-text new-value">{{ change.newValue }}</span>
            </div>
          </div>
        </div>
      </div>

      <!-- AI : Reason for changes input (optional) -->
      <div v-if="summary?.requiresModeration" class="reason-section">
        <label for="changeReason"
          >{{ $t('common.reasonForChanges') }}
          <span class="optional-label"
            >({{
          $t('project.optionalField')

            }})</span
          ></label
        >
        <Textarea
          id="changeReason"
          v-model="changeReason"
          rows="2"
          :placeholder="$t('common.explainChanges')"
        />
      </div>
    </div>

    <template #footer>
      <div class="dialog-footer">
        <Button :label="$t('common.cancel')" severity="secondary" @click="handleCancel" />
        <Button
          :label="$t('submission.confirmSubmit')"
          :severity="summary?.requiresModeration ? 'warn' : 'success'"
          :loading="isSubmitting"
          :disabled="summary?.changes.length === 0 && summary?.changeType !== 'create'"
          @click="handleConfirm"
        />
      </div>
    </template>
  </Dialog>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import type { SubmissionSummary } from '@/composables/submission/useSubmissionService';

const { t: $t } = useI18n();

// AI : Change reason input
const changeReason = ref('');

// AI : Props
interface Props {
  visible: boolean;
  summary: SubmissionSummary | null;
  isSubmitting?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  isSubmitting: false
});

// AI : Emits
const emit = defineEmits<{
  'update:visible': [value: boolean];
  'confirm': [reason: string];
  'cancel': [];
  'remove-change': [index: number, field: string, overlayId?: string];
}>();

// AI : Local visibility state
const isVisible = ref(props.visible);

// AI : Watch for external visibility changes
watch(() => props.visible, (newValue) => {
  isVisible.value = newValue;
});

// AI : Handle visibility change from dialog
function handleVisibilityChange(value: boolean) {
  emit('update:visible', value);
}

// AI : Handle cancel button
function handleCancel() {
  changeReason.value = '';
  emit('cancel');
  emit('update:visible', false);
}

// AI : Handle confirm button
function handleConfirm() {
  emit('confirm', changeReason.value);
  changeReason.value = '';
}

// AI : Handle remove change button click
function handleRemoveChange(index: number, field: string, overlayId?: string) {
  emit('remove-change', index, field, overlayId);
}

// AI : Handle image load error - replace with fallback icon
function handleImageError(event: Event) {
  const img = event.target as HTMLImageElement;
  img.style.display = 'none';
}
</script>

<style scoped>
.submission-summary {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  padding: 0.5rem 0;
}

.entity-info {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.75rem;
  background: var(--p-surface-50);
  border-radius: 6px;
}

.changes-section {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.changes-list {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.change-item {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  padding: 0.75rem;
  background: var(--p-surface-0);
  border: 1px solid var(--p-surface-200);
  border-radius: 4px;
}

/* AI : Header row for overlay changes with thumbnail and delete button */
.change-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
}

.change-thumbnail-row {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  flex: 1;
  min-width: 0;
}

/* AI : Thumbnail image styling */
.change-thumbnail {
  width: 48px;
  height: 48px;
  object-fit: cover;
  border-radius: 4px;
  border: 1px solid var(--p-surface-200);
  flex-shrink: 0;
}

/* AI : Delete button for individual changes */
.delete-change-btn {
  flex-shrink: 0;
}

.field-label {
  font-weight: 500;
  font-size: 0.875rem;
  color: var(--p-text-color-secondary);
}

.change-diff {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.value-text {
  flex: 1;
  padding: 0.5rem;
  border-radius: 4px;
  font-size: 0.9rem;
  word-break: break-word;
}

.old-value {
  background: var(--p-surface-100);
  color: var(--p-text-color-secondary);
  text-decoration: line-through;
}

.new-value {
  background: var(--p-primary-50);
  color: var(--p-text-color);
  font-weight: 500;
}

.change-diff i {
  color: var(--p-surface-400);
  font-size: 0.875rem;
  flex-shrink: 0;
}

.reason-section {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.reason-section label {
  font-weight: 500;
  font-size: 0.875rem;
  color: var(--p-text-color-secondary);
}

.optional-label {
  font-weight: 400;
  font-style: italic;
}

.dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: 0.75rem;
}
</style>
