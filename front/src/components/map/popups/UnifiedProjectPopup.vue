<template>
  <div class="unified-popup" @click.stop>
    <div v-if="loading" class="loading-spinner">
      <i class="pi pi-spin pi-spinner"></i>
    </div>
    <div v-else class="project-details">
      <!-- Project Information Section -->
      <ProjectMetadataCard
        :project="project"
        :show-description="true"
        :show-coordinates="!overlay"
        :available-cities="availableCities"
      >
        <template #actions="{ project }">
          <!-- AI : Direct edit button (for owned projects) -->
          <Button
            v-if="!viewMode && project && user && project.ownerId === user.id"
            icon="pi pi-pencil"
            class="p-button-sm p-button-text p-button-info"
            @click="emit('edit-project', project)"
            v-tooltip.top="$t('project.edit')"
          />
          <!-- AI : Suggest changes button (for non-owned projects) -->
          <Button
            v-else-if="!viewMode && project && user && project.ownerId !== user.id"
            icon="pi pi-file-edit"
            class="p-button-sm p-button-text p-button-secondary"
            @click="emit('edit-project', project)"
            v-tooltip.top="$t('tooltips.suggestChanges')"
          />
          <!-- AI : Close button (only for project-only view) -->
          <Button
            v-if="!overlay"
            icon="pi pi-times"
            class="p-button-sm p-button-text p-button-secondary"
            @click="emit('close-popup')"
            v-tooltip.top="$t('common.close')"
          />
        </template>
      </ProjectMetadataCard>

      <!-- Overlay Information Section (only if viewing an overlay) -->
      <div v-if="overlay" class="overlay-section">
        <div class="section-header-row">
          <div class="section-header">{{ $t("overlay.overlayInformation") }}</div>
          <div class="overlay-actions">
            <!-- AI : Direct edit button (for owned overlays) -->
            <Button
              v-if="!viewMode && user && overlay.authorId === user.id"
              icon="pi pi-pencil"
              class="p-button-sm p-button-text p-button-info"
              @click="emit('edit-overlay', overlay)"
              v-tooltip.top="$t('tooltips.editOverlay')"
            />
            <!-- AI : Suggest changes button (for non-owned overlays) -->
            <Button
              v-else-if="!viewMode && user && overlay.authorId !== user.id"
              icon="pi pi-file-edit"
              class="p-button-sm p-button-text p-button-secondary"
              @click="emit('edit-overlay', overlay)"
              v-tooltip.top="$t('tooltips.suggestChanges')"
            />
          </div>
        </div>

        <div class="info-card">
          <div class="info-row">
            <span class="info-label">{{$t("common.name")}}:</span>
            <span class="info-value">{{ overlay.caption ?? '—' }}</span>
          </div>
          <!-- AI : Show view original button for pending replacements -->
          <div
            v-if="overlay.replacesOverlayId && overlay.status === 'pending'"
            class="info-row replacement-info"
          >
            <button
              class="replacement-link-button"
              @click.stop="emit('view-original-overlay', overlay.replacesOverlayId)"
            >
              <i class="pi pi-arrow-left"></i>
              {{ $t('overlay.viewOriginalOverlay') }}
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- Publish Section - Show when changes exist -->
    <div v-if="!viewMode && hasChanges" class="publish-section">
      <Button
        :label="isPublishedToBackend ? $t('project.submitChangeRequest') : (overlay ? $t('overlay.publishOverlay') : $t('project.publish'))"
        :icon="isPublishedToBackend ? 'pi pi-send' : 'pi pi-cloud-upload'"
        :severity="isPublishedToBackend ? 'info' : 'success'"
        size="small"
        class="w-full"
        :loading="publishLoading"
        @click="handlePublishClick"
      />
    </div>

    <!-- Add Images Section - Always show in edit mode -->
    <div v-if="!viewMode" class="add-images-section">
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
import { storeToRefs } from 'pinia'
import { useAuthStore } from '@stores/authStore'
import { useI18n } from 'vue-i18n'
import type { OverlayObject, Project } from '@types'
import ProjectMetadataCard from './ProjectMetadataCard.vue'

const { t: $t } = useI18n()

interface Props {
  project: Project
  overlay?: OverlayObject | null
  viewMode?: boolean
  publishLoading?: boolean
  loading?: boolean
  availableCities?: Array<{ id: string; name: string; countryCode: string; }>
}

const props = withDefaults(defineProps<Props>(), {
  overlay: null,
  viewMode: false,
  publishLoading: false,
  loading: false,
  availableCities: () => []
})

const emit = defineEmits<{
  'edit-project': [project: Project]
  'edit-overlay': [overlay: OverlayObject]
  'publish-overlay': []
  'publish-project': []
  'close-popup': []
  'add-images': []
  'view-original-overlay': [overlayId: string]
}>()

const authStore = useAuthStore()
const { user } = storeToRefs(authStore)

// AI : Check if project/overlay is published to backend
const isPublishedToBackend = computed(() => {
  if (props.overlay) {
    return props.overlay.status === 'approved' || props.overlay.status === 'pending'
  }
  return props.project?.status === 'approved' || props.project?.status === 'pending'
})

// AI : Check if overlay or project has changes that need to be published
const hasChanges = computed(() => {
  const overlayModified = props.overlay?.isModified || false
  const projectModified = props.project?.isModified || false
  return overlayModified || projectModified || !isPublishedToBackend.value
})

// AI : Handle publish button click
function handlePublishClick() {
  if (props.overlay) {
    emit('publish-overlay')
  } else {
    emit('publish-project')
  }
}
</script>

<style scoped>
@import '@assets/info-card-shared.css';

.unified-popup {
  padding: 1rem;
  width: 420px;
  min-height: 200px;
  background-color: var(--p-surface-0);
  cursor: text;
  user-select: text;
  border-radius: 0.75rem;
  box-shadow: var(--p-shadow-md);
  max-width: 300px;
  border: 1px solid var(--p-surface-border);
  pointer-events: auto;
  position: relative;
  /* AI : Position above the marker (for project markers) */
  transform: translateY(calc(20px)) translateX(-50%);
  z-index: 1000;
}

.loading-spinner {
  display: flex;
  justify-content: center;
  align-items: center;
  height: 200px;
}

.unified-popup .p-button-sm {
  padding: 0.25rem 0.5rem;
  font-size: 0.75rem;
}

.overlay-section {
  margin-top: 1rem;
  padding-top: 1rem;
  border-top: 1px solid var(--p-surface-200);
}

.overlay-actions {
  display: flex;
  gap: 0.25rem;
}

.replacement-info {
  margin-top: 0.5rem;
  padding-top: 0.5rem;
  border-top: 1px solid var(--p-surface-200);
}

.replacement-link-button {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  font-weight: 500;
  font-size: 0.875rem;
  color: var(--p-purple-600);
  background-color: var(--p-purple-50);
  border: 1px solid var(--p-purple-200);
  border-radius: 0.375rem;
  cursor: pointer;
  padding: 0.375rem 0.75rem;
  transition: all 0.2s;
  width: 100%;
  justify-content: center;
}

.replacement-link-button:hover {
  background-color: var(--p-purple-100);
  border-color: var(--p-purple-300);
  color: var(--p-purple-700);
}

.replacement-link-button i {
  font-size: 0.875rem;
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
