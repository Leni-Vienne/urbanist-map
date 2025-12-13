<template>
  <!-- AI : Geometry field with preview buttons -->
  <div v-if="isGeometryField(change.fieldName)" class="geometry-change-controls">
    <div class="geometry-buttons">
      <Button
        icon="pi pi-map-marker"
        :label="$t('overlay.viewCurrentPosition')"
        @click.stop="$emit('preview-geometry', change.oldValue, 'old', change.id)"
        severity="success"
        :outlined="!isPreviewActive(change.id, 'old')"
        size="small"
      />
      <Button
        icon="pi pi-map-marker"
        :label="$t('overlay.viewSuggestedPosition')"
        @click.stop="$emit('preview-geometry', change.newValue, 'new', change.id)"
        severity="warn"
        :outlined="!isPreviewActive(change.id, 'new')"
        size="small"
      />
    </div>
  </div>

  <!-- AI : City field with clickable locations -->
  <div v-else-if="change.fieldName === 'cityId'" class="change-values">
    <span class="old-value">
      <ClickableLocation
        v-if="change.oldValue"
        :city-id="String(change.oldValue)"
        :city-name="change.oldCityName"
        :country-code="change.oldCountryCode"
        :country-name="change.oldCountryName"
      />
      <template v-else>{{ $t('overlay.notSet') }}</template>
    </span>
    <i class="pi pi-arrow-right"></i>
    <span class="new-value">
      <ClickableLocation
        v-if="change.newValue"
        :city-id="String(change.newValue)"
        :city-name="change.newCityName"
        :country-code="change.newCountryCode"
        :country-name="change.newCountryName"
      />
      <template v-else>{{ $t('overlay.notSet') }}</template>
    </span>
  </div>

  <!-- AI : Regular field with formatted values -->
  <div v-else class="change-values">
    <span class="old-value">{{ formatValue(change.oldValue, change.fieldName, change) }}</span>
    <i class="pi pi-arrow-right"></i>
    <span class="new-value">{{ formatValue(change.newValue, change.fieldName, change) }}</span>
  </div>

  <!-- AI : Change reason if provided -->
  <div v-if="change.changeReason" class="change-reason">
    <em>{{ $t('moderation.reason') }}: {{ change.changeReason }}</em>
  </div>

  <!-- AI : Change date and contributor -->
  <div class="change-date">
    <em>
      <ContributorInfo
        :date="change.createdAt"
        :contributor-id="change.requestedBy"
        :contributor-username="(change as any).requestedByUsername"
        :report-count="(change as any).requestedByReportCount ?? 0"
        :clickable="showUserStatsLink"
        @click-contributor="handleClickContributor"
      />
    </em>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import type { PendingChangeRequest } from '../../types/api';
import type { ProjectForModeration } from '@/types/index';
import ClickableLocation from '@/components/common/ClickableLocation.vue';
import ContributorInfo from '@/components/common/ContributorInfo.vue';

interface Props {
  change: PendingChangeRequest;
  projects: ProjectForModeration[];
  isPreviewActive: (changeId: string, type: 'old' | 'new') => boolean;
  showUserStatsLink?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  showUserStatsLink: false
});

const emit = defineEmits<{
  'preview-geometry': [geometryValue: unknown, type: 'old' | 'new', changeId: string];
  'click-contributor': [data: { userId: string; username: string | null; reportCount: number }];
}>();

function handleClickContributor(data: { userId: string; username: string | null; reportCount: number }) {
  emit('click-contributor', data);
}

const { t } = useI18n();

function isGeometryField(fieldName: string): boolean {
  return fieldName === 'corners' || fieldName === 'centroid';
}

function formatValue(value: unknown, fieldName: string, change?: PendingChangeRequest): string {
  if (value === null || value === undefined || value === '') {
    return t('overlay.notSet');
  }

  // AI : Handle cityId field using backend-enriched data
  if (fieldName === 'cityId' && typeof value === 'string' && change) {
    const isOldValue = change.oldValue === value;
    const cityName = isOldValue ? change.oldCityName : change.newCityName;
    const countryName = isOldValue ? change.oldCountryName : change.newCountryName;

    if (cityName && countryName) {
      return `${cityName}, ${countryName}`;
    } else if (cityName) {
      return cityName;
    }

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
</script>

<style scoped>
.geometry-change-controls {
  margin: 0.5rem 0;
}

.geometry-buttons {
  display: flex;
  gap: 0.5rem;
  flex-wrap: wrap;
}

.change-values {
  display: flex;
  align-items: flex-start;
  gap: 0.5rem;
  margin: 0.25rem 0;
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
</style>
