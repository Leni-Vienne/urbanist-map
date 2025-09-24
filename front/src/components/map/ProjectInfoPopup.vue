<template>
  <div class="project-info-popup">
    <div
      v-if="loading"
      class="loading-spinner"
    >
      <i class="pi pi-spin pi-spinner"></i>
    </div>
    <div
      v-else
      class="project-details"
    >
      <!-- Project Information Section -->
      <div class="project-meta mb-3">
        <div class="section-header-row">
          <div class="section-header">{{ $t('project.information') }}</div>
          <div class="project-actions">
            <!-- AI : Edit button for project details -->
            <Button
              v-if="!viewMode"
              icon="pi pi-pencil"
              class="p-button-sm p-button-text p-button-info"
              @click="emit('edit-project', project)"
              v-tooltip.top="$t('project.edit')"
            />
            <!-- AI : Close button -->
            <Button
              icon="pi pi-times"
              class="p-button-sm p-button-text p-button-secondary"
              @click="emit('close-popup')"
              v-tooltip.top="'Close'"
            />
          </div>
        </div>
        <div class="info-card">
          <div class="info-row">
            <span class="info-label">{{ $t('project.name') }}:</span>
            <span class="info-value">{{ project.name ?? 'Not specified' }}</span>
          </div>
          <div class="info-row">
            <span class="info-label">{{ $t('project.description') }}:</span>
            <span class="info-value">{{ project.description ?? 'Not specified' }}</span>
          </div>
          <div class="info-row">
            <span class="info-label">{{ $t('project.location') }}:</span>
            <span class="info-value">{{ getProjectLocationDisplay(project) }}</span>
          </div>
          <div class="info-row">
            <span class="info-label">{{ $t('project.coordinates') }}:</span>
            <span class="info-value info-small">{{ project.lat?.toFixed(5) }}, {{ project.lng?.toFixed(5) }}</span>
          </div>
          <div class="info-row">
            <span class="info-label">{{ $t('project.period') }}:</span>
            <span class="info-value info-small">
              <span v-if="!project.startDate && !project.endDate">Not specified</span>
              <span v-else>
                {{ formatDate(project.startDate) }} - {{ project.endDate ? formatDate(project.endDate) : 'Present' }}
              </span>
            </span>
          </div>
          <div
            v-if="project.sourceUrl"
            class="info-row"
          >
            <span class="info-label">{{ $t('project.source') }}:</span>
            <a
              :href="project.sourceUrl"
              target="_blank"
              class="info-link"
            >{{ project.sourceUrl }}</a>
          </div>
          <div
            v-if="project.latestUpdateOn"
            class="info-row"
          >
            <span class="info-label">{{ $t('project.latestUpdate') }}:</span>
            <span class="info-value info-small">{{ formatDate(project.latestUpdateOn) }}</span>
          </div>
        </div>
      </div>
    </div>

    <!-- Publish Project Section - Only for marker projects that haven't been published yet -->
    <div
      v-if="!viewMode && project.isMarker && !isPublishedToBackend"
      class="publish-section"
    >
      <Button
        :label="$t('project.publish')"
        icon="pi pi-cloud-upload"
        severity="success"
        size="small"
        class="w-full"
        :loading="publishLoading"
        @click="emit('publish-project')"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { Project } from '@types';


// AI : Props
const props = defineProps<{
  project: Project;
  viewMode?: boolean;
  publishLoading?: boolean;
  loading?: boolean;
  availableCities?: Array<{ id: string; name: string; countryCode: string; }>;
}>();

// AI : Events
const emit = defineEmits<{
  'publish-project': [];
  'edit-project': [project: Project];
  'close-popup': [];
}>();

// AI : Check if project is published to backend (simple heuristic)
const isPublishedToBackend = computed(() => {
  // AI : If project has backend-style ID format or other indicators, consider it published
  return props.project.savedRemotely || false;
});

// AI : Simple presentation helper functions
function formatDate(date: Date | null): string {
  if (!date) return 'Not specified';
  return new Date(date).toLocaleDateString();
}

function getProjectLocationDisplay(project: Project): string {
  if (project.city?.name) {
    return `${project.city.name}, ${project.city.countryCode}`;
  }

  // AI : Use available cities if provided by parent
  if (project.cityId && props.availableCities) {
    const city = props.availableCities.find(c => c.id === project.cityId);
    if (city) {
      return `${city.name}, ${city.countryCode}`;
    }
  }

  return 'Not specified';
}
</script>

<style scoped>
.project-info-popup {
  padding: 1rem;
  width: 420px;
  min-height: 200px;
  background-color: var(--p-surface-0);
  cursor: text;
  user-select: text;
  border-radius: 0.75rem;
  box-shadow: var(--p-shadow-md);
  /* AI : Compact styles for InfoPopup */
  max-width: 300px;
  border: 1px solid var(--p-surface-border);
  /* AI : Prevent dev tools interference */
  pointer-events: auto;
  position: relative;
  /* AI : Position above the marker (teleport target is at marker position) */
  transform: translateY(calc(-100% - 20px)) translateX(-50%);
  z-index: 1000;
}

.loading-spinner {
  display: flex;
  justify-content: center;
  align-items: center;
  height: 200px;
}

.project-info-popup .p-button-sm {
  padding: 0.25rem 0.5rem;
  font-size: 0.75rem;
}

.project-actions {
  display: flex;
  gap: 0.25rem;
}

.section-header {
  font-size: 0.875rem;
  font-weight: 600;
  color: var(--p-surface-700);
  margin-bottom: 0.5rem;
}

.section-header-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 0.5rem;
}

/* AI : Info card styling */
.info-card {
  background-color: var(--p-surface-50);
  border: 1px solid var(--p-surface-200);
  border-radius: 0.375rem;
  padding: 0.75rem;
  font-size: 0.875rem;
}

.info-row {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 0.5rem;
}

.info-row:last-child {
  margin-bottom: 0;
}

.info-label {
  font-weight: 500;
  color: var(--p-surface-600);
  flex-shrink: 0;
  margin-right: 0.5rem;
}

.info-value {
  text-align: right;
  color: var(--p-surface-900);
  flex-grow: 1;
  word-wrap: break-word;
}

.info-small {
  font-size: 0.75rem;
}

.info-link {
  color: var(--p-primary-500);
  text-decoration: none;
  font-size: 0.75rem;
  max-width: 8rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.info-link:hover {
  text-decoration: underline;
}

.publish-section {
  margin-top: 1rem;
  padding-top: 1rem;
  border-top: 1px solid var(--p-surface-200);
}
</style>