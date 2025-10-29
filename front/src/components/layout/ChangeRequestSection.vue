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
      <div
        v-for="change in changes"
        :key="change.id"
        :class="['change-item', { 'conflicted': change.status === 'conflicted' }]"
      >
        <div v-if="change.status === 'conflicted'" class="conflict-banner">
          <i class="pi pi-info-circle"></i>
          <span>{{ $t('moderation.conflictDetected') }}</span>
          <span class="conflict-help">{{ $t('moderation.resolveConflictsTooltip') }}</span>
        </div>
        <div class="change-content">
          <div class="change-field">
            <div class="field-header">
              <strong>{{ formatFieldName(change.fieldName) }}:</strong>
              <span v-if="change.requestedBy" class="requested-by">
                {{ $t('moderation.by') }} {{ getUserId(change.requestedBy) }}
              </span>
            </div>
            <div v-if="isGeometryField(change.fieldName)" class="geometry-change-controls">
              <div class="geometry-buttons">
                <Button
                  icon="pi pi-map-marker"
                  :label="$t('overlay.viewCurrentPosition')"
                  @click.stop="previewGeometry(change.oldValue, 'old', change.id)"
                  severity="success"
                  :outlined="!isPreviewActive(change.id, 'old')"
                  size="small"
                />
                <Button
                  icon="pi pi-map-marker"
                  :label="$t('overlay.viewSuggestedPosition')"
                  @click.stop="previewGeometry(change.newValue, 'new', change.id)"
                  severity="warn"
                  :outlined="!isPreviewActive(change.id, 'new')"
                  size="small"
                />
              </div>
            </div>
            <div v-else class="change-values">
              <span class="old-value">{{ formatValue(change.oldValue, change.fieldName) }}</span>
              <i class="pi pi-arrow-right"></i>
              <span class="new-value">{{ formatValue(change.newValue, change.fieldName) }}</span>
            </div>
            <div v-if="change.changeReason" class="change-reason">
              <em>{{ $t('moderation.reason') }}: {{ change.changeReason }}</em>
            </div>
            <div class="change-date">
              <em>{{ $t('moderation.requested') }}: {{ new Date(change.createdAt).toLocaleString() }}</em>
            </div>
          </div>
          <div v-if="$slots['change-actions']" class="change-actions">
            <slot name="change-actions" :change="change"></slot>
          </div>
        </div>
      </div>
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

function isGeometryField(fieldName: string): boolean {
  return fieldName === 'corners' || fieldName === 'centroid';
}

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

function formatValue(value: unknown, fieldName: string): string {
  if (value === null || value === undefined || value === '') {
    return t('overlay.notSet');
  }

  if (fieldName === 'projectId' && typeof value === 'string') {
    const project = props.projects.find(p => p.id === value);
    return project?.name ?? `Unknown Project (${value.slice(0, 8)}...)`;
  }

  // AI : Handle cityId field by looking up city name from all loaded projects and overlays
  if (fieldName === 'cityId' && typeof value === 'string') {
    // AI : Build a map of all cityId -> cityName pairs from projects and overlays
    const cityMap = new Map<string, string>();

    for (const project of props.projects) {
      if (project.cityId && project.cityName) {
        cityMap.set(project.cityId, project.cityName);
      }
      if (project.overlays) {
        for (const overlay of project.overlays) {
          if (overlay.cityId && overlay.cityName) {
            cityMap.set(overlay.cityId, overlay.cityName);
          }
        }
      }
    }

    const cityName = cityMap.get(value);
    if (cityName) {
      return cityName;
    }

    // AI : City not found in loaded data - show truncated ID
    return `City (${value.slice(0, 8)}...)`;
  }

  if (fieldName === 'corners' || fieldName === 'centroid') {
    return t('overlay.coordinatesViewOnMap');
  }

  if (typeof value === 'object') {
    return JSON.stringify(value, null, 2);
  }
  return String(value);
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
  opacity: 0.7;
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

.conflict-help {
  margin-left: auto;
  font-weight: 400;
  font-size: 0.75rem;
  color: var(--p-orange-600);
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

.change-values {
  display: flex;
  align-items: flex-start;
  gap: 0.5rem;
  margin: 0.25rem 0;
  font-family: 'Courier New', monospace;
  font-size: 0.75rem;
  flex-wrap: wrap;
}

.old-value {
  color: #059669;
  background: #ecfdf5;
  padding: 0.125rem 0.25rem;
  border-radius: 3px;
  word-break: break-word;
  max-width: 150px;
}

.new-value {
  color: var(--p-tag-warn-color);
  background: var(--p-tag-warn-background);
  padding: 0.125rem 0.25rem;
  border-radius: 3px;
  word-break: break-word;
  max-width: 150px;
}

.change-reason {
  font-size: 0.75rem;
  color: var(--p-surface-600);
  margin-top: 0.25rem;
}

.change-date {
  font-size: 0.75rem;
  color: var(--p-surface-400);
  margin-top: 0.25rem;
}

.change-actions {
  display: flex;
  gap: 0.25rem;
  justify-content: flex-end;
  flex-shrink: 0;
}

.geometry-change-controls {
  margin: 0.5rem 0;
}

.geometry-buttons {
  display: flex;
  gap: 0.5rem;
  flex-wrap: wrap;
}
</style>
