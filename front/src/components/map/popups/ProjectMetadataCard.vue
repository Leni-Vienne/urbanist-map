<template>
  <div 
    v-if="project"
    class="project-meta mb-3"
  >
    <div class="section-header-row">
      <div class="section-header">{{ $t('project.information') }}</div>
      <div class="project-actions">
        <slot name="actions" :project="project" />
      </div>
    </div>
    <div class="info-card">
      <div class="info-row">
        <span class="info-label">{{ $t('project.name') }}:</span>
        <span class="info-value">{{ project.name ?? 'Not specified' }}</span>
      </div>
      <div 
        v-if="showDescription"
        class="info-row"
      >
        <span class="info-label">{{ $t('project.description') }}:</span>
        <span class="info-value">{{ project.description ?? 'Not specified' }}</span>
      </div>
      <div class="info-row">
        <span class="info-label">{{ $t('project.location') }}:</span>
        <span class="info-value">{{ getProjectLocationDisplay(project) }}</span>
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
</template>

<script setup lang="ts">
import type { Project } from '@types'

interface Props {
  project: Project | null
  showDescription?: boolean
  availableCities?: Array<{ id: string; name: string; countryCode: string; }>
}

const props = withDefaults(defineProps<Props>(), {
  showDescription: false,
  availableCities: () => []
})

function formatDate(date: string | Date | null | undefined): string {
  if (!date) return 'Not specified'
  return new Date(date).toLocaleDateString()
}

function getProjectLocationDisplay(project: Project): string {
  if (project.city?.name) {
    return `${project.city.name}, ${project.city.countryCode}`
  }

  // AI : Use available cities if provided by parent
  if (project.cityId && props.availableCities) {
    const city = props.availableCities.find(c => c.id === project.cityId);
    if (city) {
      return `${city.name}, ${city.countryCode}`;
    }
  }

  return 'Not specified'
}
</script>

<style scoped>
.section-header {
  font-weight: 600;
  font-size: 0.85rem;
  color: var(--p-text-secondary);
  margin-bottom: 0.5rem;
  letter-spacing: 0.025em;
}

.section-header-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 0.75rem;
}

.project-actions {
  display: flex;
  gap: 0.25rem;
}

.info-card {
  background-color: var(--p-surface-50);
  border-radius: 0.5rem;
  padding: 0.75rem;
  border: 1px solid var(--p-surface-200);
}

.info-row {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  padding: 0.25rem 0;
  border-bottom: 1px solid var(--p-surface-100);
}

.info-row:last-child {
  border-bottom: none;
}

.info-label {
  font-weight: 600;
  color: var(--p-text-secondary);
  font-size: 0.875rem;
  min-width: 80px;
  margin-right: 0.5rem;
}

.info-value {
  flex: 1;
  text-align: right;
  word-break: break-word;
  font-size: 0.875rem;
}

.info-small {
  font-size: 0.8rem;
  color: var(--p-text-muted);
}

.info-link {
  color: var(--p-primary-500);
  text-decoration: none;
  word-break: break-all;
}

.info-link:hover {
  text-decoration: underline;
}
</style>