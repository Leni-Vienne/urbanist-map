<template>
  <!-- This is for development projects (single marker projects without overlay)-->
  <div class="project-info-popup" @click.stop>
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

    <!-- Publish Project Section - Show when project has changes or hasn't been published yet -->
    <div
      v-if="!viewMode && (hasChanges || !isPublishedToBackend)"
      class="publish-section"
    >
      <Button
        :label="isPublishedToBackend ? $t('project.submitChangeRequest') : $t('project.publish')"
        :icon="isPublishedToBackend ? 'pi pi-send' : 'pi pi-cloud-upload'"
        :severity="isPublishedToBackend ? 'info' : 'success'"
        :disabled="!hasChanges && isPublishedToBackend"
        size="small"
        class="w-full"
        :loading="publishLoading"
        @click="emit('publish-project')"
      />
    </div>

    <!-- Add Images Section - Show in edit mode for published projects -->
    <div
      v-if="!viewMode && isPublishedToBackend"
      class="add-images-section"
    >
      <Button
        :label="$t('project.addImages')"
        icon="pi pi-images"
        severity="secondary"
        size="small"
        class="w-full"
        @click="emit('add-images')"
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
  'add-images': []
}>()

const isPublishedToBackend = computed(() => {
  return props.project?.status === 'approved' || props.project?.status === 'pending'
})

// AI : Check if project has changes that need to be published
const hasChanges = computed(() => {
  return props.project?.isModified || false
})
</script>

<style scoped>
@import '@assets/info-card-shared.css';

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

.publish-section {
  margin-top: 1rem;
  padding-top: 1rem;
  border-top: 1px solid var(--p-surface-200);
}

.add-images-section {
  margin-top: 0.5rem;
}
</style>