<template>
  <Dialog
    v-model:visible="isVisible"
    modal
    :header="$t('moderation.replacementConflicts.title')"
    :style="{ width: '700px', maxHeight: '80vh' }"
    @update:visible="handleVisibilityChange"
  >
    <div
      v-if="conflicts"
      class="conflicts-container"
    >
      <!-- Summary -->
      <div class="conflict-summary">
        <p class="summary-text">
          {{ $t('moderation.replacementConflicts.approvingWillReplace', { original: conflicts.originalOverlayCaption || 'Unnamed' }) }}
        </p>
      </div>

      <!-- Pending Change Requests -->
      <div
        v-if="conflicts.pendingChangeRequests.length > 0"
        class="section"
      >
        <div class="section-header">
          <i class="pi pi-exclamation-triangle"></i>
          <span>{{ $t('moderation.replacementConflicts.pendingChanges', { count: conflicts.pendingChangeRequests.length }) }}</span>
        </div>
        <div class="scrollable-list">
          <div
            v-for="change in conflicts.pendingChangeRequests"
            :key="change.id"
            class="conflict-item change-request-item"
          >
            <div class="item-header">
              <strong>{{ $t(`fields.${change.fieldName}`) }}</strong>
              <Tag
                severity="warning"
                :value="$t('status.pending')"
                size="small"
              />
            </div>
            <div class="change-diff">
              <span class="value-text">{{ formatValue(change.oldValue) }}</span>
              <i class="pi pi-arrow-right"></i>
              <span class="value-text">{{ formatValue(change.newValue) }}</span>
            </div>
            <div
              v-if="change.changeReason"
              class="change-reason"
            >
              {{ change.changeReason }}
            </div>
          </div>
        </div>
        <p class="warning-text">
          {{ $t('moderation.replacementConflicts.changesWillBeConflicted') }}
        </p>
      </div>

      <!-- Competing Replacements -->
      <div
        v-if="conflicts.competingReplacements.length > 0"
        class="section"
      >
        <div class="section-header">
          <i class="pi pi-clone"></i>
          <span>{{ $t('moderation.replacementConflicts.competingReplacements', { count: conflicts.competingReplacements.length }) }}</span>
        </div>
        <div class="scrollable-list">
          <div
            v-for="competing in conflicts.competingReplacements"
            :key="competing.id"
            class="conflict-item competing-item"
          >
            <div class="item-header">
              <strong>{{ competing.caption || $t('overlay.untitled') }}</strong>
              <span class="item-date">{{ formatDate(competing.createdAt) }}</span>
            </div>
            <div class="item-filename">{{ competing.filename }}</div>
          </div>
        </div>
        <p class="warning-text">
          {{ $t('moderation.replacementConflicts.competingWillBeRejected') }}
        </p>
      </div>
    </div>

    <template #footer>
      <div class="dialog-footer">
        <Button
          :label="$t('common.cancel')"
          severity="secondary"
          :disabled="isLoading"
          @click="handleCancel"
        />
        <Button
          :label="$t('moderation.replacementConflicts.approveAndResolve')"
          severity="danger"
          :loading="isLoading"
          icon="pi pi-check"
          @click="handleConfirm"
        />
      </div>
    </template>
  </Dialog>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';

const { t: $t } = useI18n();

// AI : Conflicts data structure returned from backend
export interface ReplacementConflicts {
  isReplacement: boolean;
  originalOverlayCaption: string | null;
  pendingChangeRequests: Array<{
    id: string;
    fieldName: string;
    oldValue: any;
    newValue: any;
    changeReason: string | null;
    requestedBy: string | null;
    createdAt: Date;
  }>;
  competingReplacements: Array<{
    id: string;
    filename: string;
    caption: string | null;
    authorId: string | null;
    createdAt: Date;
  }>;
  hasConflicts: boolean;
}

// AI : Props
interface Props {
  visible: boolean;
  conflicts: ReplacementConflicts | null;
  isLoading?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  isLoading: false
});

// AI : Emits
const emit = defineEmits<{
  'update:visible': [value: boolean];
  'confirm': [];
  'cancel': [];
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
  emit('cancel');
  isVisible.value = false;
}

// AI : Handle confirm button
function handleConfirm() {
  emit('confirm');
}

// AI : Format value for display
function formatValue(value: any): string {
  if (value === null || value === undefined) {
    return $t('common.unknown');
  }
  if (typeof value === 'object') {
    return JSON.stringify(value);
  }
  return String(value);
}

// AI : Format date for display
function formatDate(date: Date): string {
  return new Date(date).toLocaleDateString();
}
</script>

<style scoped>
.conflicts-container {
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
}

.conflict-summary {
  padding: 1rem;
  background-color: var(--p-amber-50);
  border-left: 4px solid var(--p-amber-500);
  border-radius: 0.5rem;
}

.summary-text {
  margin: 0;
  color: var(--p-amber-900);
  font-weight: 500;
}

.section {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.section-header {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 1rem;
  font-weight: 600;
  color: var(--p-surface-800);
}

.section-header i {
  color: var(--p-orange-600);
}

.scrollable-list {
  max-height: 250px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  padding-right: 0.5rem;
}

.conflict-item {
  padding: 1rem;
  background-color: var(--p-surface-50);
  border: 1px solid var(--p-surface-200);
  border-radius: 0.5rem;
}

.item-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 0.5rem;
}

.item-date {
  font-size: 0.875rem;
  color: var(--p-surface-600);
}

.item-filename {
  font-size: 0.875rem;
  color: var(--p-surface-600);
  font-family: monospace;
}

.change-diff {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  margin-top: 0.5rem;
  padding: 0.5rem;
  background-color: var(--p-surface-0);
  border-radius: 0.375rem;
}

.value-text {
  padding: 0.25rem 0.5rem;
  background-color: var(--p-surface-100);
  border-radius: 0.25rem;
  font-size: 0.875rem;
  font-family: monospace;
}

.change-reason {
  margin-top: 0.5rem;
  padding: 0.5rem;
  font-size: 0.875rem;
  color: var(--p-surface-700);
  background-color: var(--p-surface-100);
  border-radius: 0.25rem;
  font-style: italic;
}

.warning-text {
  margin: 0;
  padding: 0.75rem;
  background-color: var(--p-red-50);
  color: var(--p-red-900);
  border-radius: 0.375rem;
  font-size: 0.875rem;
  font-weight: 500;
}

.dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: 0.75rem;
}
</style>
