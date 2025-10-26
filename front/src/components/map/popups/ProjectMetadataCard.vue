<template>
  <div
    v-if="project"
    class="mb-3"
  >
    <div class="section-header-row">
      <div class="section-header">{{ $t('project.information') }}</div>
      <div class="project-actions">
        <slot
          name="actions"
          :project="project"
        />
      </div>
    </div>
    <div class="info-card">
      <div class="info-row">
        <span class="info-label">{{ $t('project.name') }}:</span>
        <span class="info-value">{{ project.name ?? '—' }}</span>
      </div>
      <div
        v-if="showDescription"
        class="info-row"
      >
        <span class="info-label">{{ $t('project.description') }}:</span>
        <span class="info-value">{{ project.description ?? '—' }}</span>
      </div>
      <div class="info-row">
        <span class="info-label">{{ $t('project.location') }}:</span>
        <span class="info-value">{{ projectLocationDisplay }}</span>
      </div>
      <div class="info-row">
        <span class="info-label">{{ $t('project.period') }}:</span>
        <span class="info-value info-small">
          <span v-if="project.startDate && project.endDate">
            {{ formatDate(project.startDate) }} - {{ formatDate(project.endDate) }}
          </span>
          <span v-else-if="project.proposalDate">
            Proposed on {{ formatDate(project.proposalDate) }}</span>
          <span v-else>
            Not specified
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
import { computed } from 'vue'
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

// AI : Convert to computed property for reactivity to project changes
const projectLocationDisplay = computed(() => {
  if (!props.project) return '—'

  const project = props.project;

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

  return '—'
})
</script>

<style scoped>
@import '@assets/info-card-shared.css';

.project-actions {
  display: flex;
  gap: 0.25rem;
}
</style>