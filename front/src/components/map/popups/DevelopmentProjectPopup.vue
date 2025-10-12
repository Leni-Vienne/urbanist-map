<template>
  <!-- This is for development projects (single marker projects without overlay)-->
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
      <ProjectMetadataCard
        :project="project"
        :show-description="true"
        :show-coordinates="true"
        :available-cities="availableCities"
      >
        <template #actions="{ project }">
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
            v-tooltip.top="$t('common.close')"
          />
        </template>
      </ProjectMetadataCard>
    </div>

    <!-- Publish Project Section - Only for development projects that haven't been published yet -->
    <div
      v-if="!viewMode && !isPublishedToBackend"
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
import { computed } from 'vue'
import type { Project } from '@types'
import ProjectMetadataCard from './ProjectMetadataCard.vue'

interface Props {
  project: Project
  viewMode?: boolean
  publishLoading?: boolean
  loading?: boolean
  availableCities?: Array<{ id: string; name: string; countryCode: string; }>
}

const props = withDefaults(defineProps<Props>(), {
  viewMode: false,
  publishLoading: false,
  loading: false,
  availableCities: () => []
})

const emit = defineEmits<{
  'edit-project': [project: Project]
  'publish-project': []
  'close-popup': []
}>()

const isPublishedToBackend = computed(() => {
  return props.project?.savedRemotely ?? false
})
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
  transform: translateY(calc(20px)) translateX(-50%);
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

.publish-section {
  margin-top: 1rem;
  padding-top: 1rem;
  border-top: 1px solid var(--p-surface-200);
}
</style>