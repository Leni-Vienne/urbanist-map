<template>
  <div :class="['change-requests-container', containerClass]">
    <div v-if="showHeader" class="change-requests-header">
      <div v-if="isOverlayChanges" class="change-indicator">
        <i class="pi pi-exclamation-triangle text-orange-500"></i>
        <span class="change-header-text">
          {{ isMyContributions
            ? $t('moderation.yourPendingChanges')
            : $t('moderation.pendingChangesFor', { name: entityName })
          }}
        </span>
      </div>
      <h3 v-else class="change-requests-title">
        {{ isMyContributions ? $t('moderation.yourPendingChanges') : $t('moderation.pendingChanges') }}
      </h3>
      <p v-if="isMyContributions" class="change-requests-subtitle">
        {{ $t('moderation.moderatorReviewRequired') }}
      </p>
    </div>

    <div class="change-requests-list">
      <!-- AI : Iterate over grouped changes -->
      <template v-for="group in groupedChanges" :key="group.type === 'single' ? group.change.id : `conflict-${group.entityId}-${group.fieldName}`">

        <!-- AI : Single non-conflicting change -->
        <div v-if="group.type === 'single'" class="change-item">
          <div class="change-content">
            <div class="change-field">
              <div class="field-header">
                <strong>{{ formatFieldName(group.change.fieldName) }}:</strong>
                <span v-if="group.change.requestedBy" class="requested-by">
                  {{ $t('moderation.by') }} {{ getUserId(group.change.requestedBy) }}
                </span>
              </div>
              <ChangeValueDisplay
                :change="group.change"
                :projects="projects"
                :is-preview-active="isPreviewActive"
                @preview-geometry="previewGeometry"
              />
            </div>
            <div v-if="$slots['change-actions']" class="change-actions">
              <slot name="change-actions" :change="group.change"></slot>
            </div>
          </div>
        </div>

        <!-- AI : Grouped conflicting changes -->
        <div v-else class="change-item conflicted">
          <div class="conflict-banner">
            <i
              class="pi pi-info-circle conflict-info-icon"
              v-tooltip.top="$t('moderation.resolveConflictsTooltip')"
            ></i>
            <span>{{ $t('moderation.conflictDetected') }}</span>
          </div>

          <!-- AI : List all competing changes -->
          <div v-for="change in group.changes" :key="change.id" class="conflict-option">
            <div class="change-content">
              <div class="change-field">
                <div class="field-header">
                  <span v-if="change.requestedBy" class="requested-by">
                    {{ $t('moderation.suggestedBy') }} {{ getUserId(change.requestedBy) }}
                  </span>
                </div>
                <ChangeValueDisplay
                  :change="change"
                  :projects="projects"
                  :is-preview-active="isPreviewActive"
                  @preview-geometry="previewGeometry"
                />
              </div>
              <div v-if="$slots['change-actions']" class="change-actions">
                <slot name="change-actions" :change="change"></slot>
              </div>
            </div>
          </div>
        </div>

      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { useToast } from '@composables/ui/useToast';
import { useChangeRequestPreview } from '@composables/overlay/useChangeRequestPreview';
import type { PendingChangeRequest } from '../../types/api';
import type { ProjectForModeration, OverlayForModeration } from '@types';
import ChangeValueDisplay from './ChangeValueDisplay.vue';

interface Props {
  changes: PendingChangeRequest[];
  allChangeRequests: PendingChangeRequest[];
  projects: ProjectForModeration[];
  isMyContributions?: boolean;
  isOverlayChanges?: boolean;
  entityName?: string;
  showHeader?: boolean;
  containerClass?: string;
  onNavigateToOverlay?: (overlayId: string) => Promise<void>;
}

const props = withDefaults(defineProps<Props>(), {
  isMyContributions: false,
  isOverlayChanges: false,
  entityName: '',
  showHeader: true,
  containerClass: ''
});

const { t } = useI18n();
const toast = useToast();
const {
  isPreviewingChange,
  getPreviewType,
  previewGeometry: previewGeometryComposable
} = useChangeRequestPreview();

// AI : Computed property to check if a specific preview is active
const isPreviewActive = computed(() => {
  return (changeId: string, type: 'old' | 'new') => {
    if (!isPreviewingChange(changeId)) return false;
    const previewType = getPreviewType(changeId);
    return (type === 'old' && previewType === 'current') || (type === 'new' && previewType === 'suggested');
  };
});

// AI : Group changes - separate conflicting changes from non-conflicting ones
type ChangeGroup = {
  type: 'single';
  change: PendingChangeRequest;
} | {
  type: 'conflict';
  fieldName: string;
  entityType: string;
  entityId: string;
  changes: PendingChangeRequest[];
};

const groupedChanges = computed<ChangeGroup[]>(() => {
  const groups: ChangeGroup[] = [];
  const processedIds = new Set<string>();

  for (const change of props.changes) {
    if (processedIds.has(change.id)) continue;

    if (change.hasConflict) {
      // AI : Find all conflicting changes for the same field
      const conflictingChanges = props.changes.filter(c =>
        c.entityType === change.entityType &&
        c.entityId === change.entityId &&
        c.fieldName === change.fieldName
      );

      // AI : Mark all as processed
      conflictingChanges.forEach(c => processedIds.add(c.id));

      // AI : Add as conflict group
      groups.push({
        type: 'conflict',
        fieldName: change.fieldName,
        entityType: change.entityType,
        entityId: change.entityId,
        changes: conflictingChanges
      });
    } else {
      // AI : Single non-conflicting change
      processedIds.add(change.id);
      groups.push({
        type: 'single',
        change
      });
    }
  }

  return groups;
});

function getUserId(userId: string | null): string {
  if (!userId) return t('common.unknown');
  return userId.slice(0, 8) + '...';
}

// AI : Format field names for display using i18n
function formatFieldName(fieldName: string): string {
  const translationKey = `fields.${fieldName}`;
  const translated = t(translationKey);
  // AI : If translation exists, use it; otherwise fall back to field name
  return translated !== translationKey ? translated : fieldName;
}

// AI : Wrapper function to handle preview with proper error handling
async function previewGeometry(geometryValue: unknown, type: 'old' | 'new', changeId: string) {
  // AI : Find the change request
  const change = props.allChangeRequests.find(c => c.id === changeId);
  if (!change) {
    toast.add({
      severity: 'error',
      summary: t('overlay.changeNotFound'),
      detail: t('overlay.couldNotFindChange'),
      life: 3000
    });
    return;
  }

  // AI : Only handle overlay changes
  if (change.entityType !== 'overlay') {
    return;
  }

  // AI : Find the overlay data
  let overlayForModeration: OverlayForModeration | null = null;
  for (const project of props.projects) {
    if (project.overlays) {
      overlayForModeration = project.overlays.find((o: OverlayForModeration) => o.id === change.entityId) ?? null;
      if (overlayForModeration) break;
    }
  }

  if (!overlayForModeration) {
    toast.add({
      severity: 'error',
      summary: t('overlay.overlayNotFound'),
      detail: t('overlay.couldNotFindOverlay'),
      life: 3000
    });
    return;
  }

  // AI : Delegate to composable
  await previewGeometryComposable({
    change,
    overlayForModeration,
    geometryValue,
    type
  });
}
</script>

<style scoped>
.change-requests-container {
  margin-top: 1rem;
}

.project-change-requests {
  padding: 0.75rem;
  background: var(--p-surface-50);
  border: 1px solid var(--p-surface-200);
  border-radius: 6px;
}

.overlay-change-requests {
  padding: 0.75rem 1rem;
  background: var(--p-orange-25);
  border-top: 1px solid var(--p-orange-200);
}

.change-requests-title {
  margin: 0 0 0.75rem 0;
  font-size: 0.875rem;
  font-weight: 600;
  color: var(--p-surface-700);
}

.change-requests-subtitle {
  margin: 0.5rem 0 0 0;
  font-size: 0.75rem;
  color: var(--p-surface-500);
  font-style: italic;
}

.change-requests-header {
  margin-bottom: 0.75rem;
}

.change-indicator {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.change-header-text {
  font-size: 0.8125rem;
  font-weight: 600;
  color: var(--p-orange-700);
}

.change-requests-list {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.change-item {
  background: white;
  border: 1px solid var(--p-surface-200);
  border-radius: 4px;
  padding: 0.5rem;
}

.change-item.conflicted {
  border-color: var(--p-blue-300);
  border-width: 2px;
  background: var(--p-blue-25);
  padding: 0;
}

.conflict-banner {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem;
  margin: -0.5rem -0.5rem 0.5rem -0.5rem;
  background: var(--p-blue-100);
  border-bottom: 1px solid var(--p-blue-200);
  border-radius: 4px 4px 0 0;
  color: var(--p-blue-700);
  font-weight: 600;
  font-size: 0.8125rem;
}

.conflict-banner i {
  color: var(--p-blue-600);
}

.conflict-info-icon {
  cursor: help;
  font-size: 1rem;
}

.field-header {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 0.25rem;
}

.requested-by {
  font-size: 0.75rem;
  color: var(--p-surface-500);
  font-weight: 400;
}

.change-content {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.change-field {
  flex: 1;
  min-width: 0;
}

.change-field strong {
  color: var(--p-surface-700);
  font-size: 0.8125rem;
}

.change-actions {
  display: flex;
  gap: 0.25rem;
  justify-content: flex-end;
  flex-shrink: 0;
}

/* AI : Styling for grouped conflict options */
.conflict-option {
  background: white;
  border-radius: 4px;
  padding: 0.75rem;
  margin: 0.5rem 0;
  border: 1px solid var(--p-blue-200);
}

.conflict-option:first-of-type {
  margin-top: 0.75rem;
}

.conflict-option:last-of-type {
  margin-bottom: 0;
}

.conflict-option:hover {
  background: var(--p-blue-25);
  border-color: var(--p-blue-300);
}

/* AI : Adjust conflict banner for grouped display */
.change-item.conflicted > .conflict-banner {
  margin: 0;
  border-radius: 4px 4px 0 0;
}
</style>
