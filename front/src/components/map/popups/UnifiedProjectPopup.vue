<template>
  <div :class="['unified-popup', `popup-source-${props.source}`]" @click.stop>
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
          <!-- AI : Edit button (owned = direct edit, non-owned = suggest changes) -->
          <Button
            v-if="!viewMode && project && user"
            icon="pi pi-pencil"
            :class="['p-button-sm', 'p-button-text']"
            @click="emit('edit-project', project)"
            v-tooltip.top="project.ownerId === user.id ? $t('project.edit') : $t('tooltips.suggestChanges')"
          />
          <!-- AI : Delete button (for unsubmitted projects or pending projects owned by user) -->
          <Button
            v-if="!viewMode && project && user && (project.status === null || project.status === 'pending') && project.ownerId === user.id"
            icon="pi pi-trash"
            :class="['p-button-sm', 'p-button-text', 'p-button-danger']"
            @click="emit('delete-project', project)"
            v-tooltip.top="$t('contribute.deleteProject')"
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
            <!-- AI : Edit button (owned = direct edit, non-owned = suggest changes) -->
            <Button
              v-if="!viewMode && user"
              icon="pi pi-pencil"
              :class="['p-button-sm', 'p-button-text']"
              @click="emit('edit-overlay', overlay)"
              v-tooltip.top="overlay.authorId === user.id ? $t('tooltips.editOverlay') : $t('tooltips.suggestChanges')"
            />
            <!-- AI : Delete button (only for pending overlays owned by user) -->
            <Button
              v-if="!viewMode && user && overlay.status === 'pending' && overlay.authorId === user.id"
              icon="pi pi-trash"
              :class="['p-button-sm', 'p-button-text', 'p-button-danger']"
              @click="emit('delete-overlay', overlay)"
              v-tooltip.top="$t('contribute.deleteOverlay')"
            />
          </div>
        </div>

        <div class="info-card">
          <div class="info-row">
            <span class="info-label">{{ $t("common.name") }}:</span>
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

    <!-- Actions Section - Edit mode buttons -->
    <div v-if="!viewMode" class="actions-section">
      <Button
        v-if="hasChanges"
        :label="isPublishedToBackend ? $t('project.submitChangeRequest') : (overlay ? $t('overlay.publishOverlay') : $t('project.publish'))"
        :icon="isPublishedToBackend ? 'pi pi-send' : 'pi pi-cloud-upload'"
        :severity="isPublishedToBackend ? 'info' : 'success'"
        :class="{ 'flex-1': hasChanges }"
        :loading="publishLoading"
        @click="handlePublishClick"
      />
      <Button
        :label="$t('project.addImages')"
        severity="secondary"
        outlined
        :class="{ 'flex-1': hasChanges, 'w-full': !hasChanges }"
        @click="emit('add-images')"
      >
        <template #icon>
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="1em"
            height="1em"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path d="M16 5h6" />
            <path d="M19 2v6" />
            <path d="M21 11.5V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7.5" />
            <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />
            <circle cx="9" cy="9" r="2" />
          </svg>
        </template>
      </Button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { storeToRefs } from 'pinia'
import { useAuthStore } from '@/stores/authStore'
import { useI18n } from 'vue-i18n'
import type { OverlayObject, Project } from '@/types/index'
import ProjectMetadataCard from './ProjectMetadataCard.vue'

const { t: $t } = useI18n()

interface Props {
  project: Project
  overlay?: OverlayObject | null
  viewMode?: boolean
  publishLoading?: boolean
  loading?: boolean
  availableCities?: { id: number; name: string; countryCode: string; }[]
  // AI : Source determines popup positioning - overlay toolbar vs project marker
  source?: 'overlay' | 'marker'
}

const props = withDefaults(defineProps<Props>(), {
  overlay: null,
  viewMode: false,
  publishLoading: false,
  loading: false,
  availableCities: () => [],
  source: 'overlay'
})

const emit = defineEmits<{
  'edit-project': [project: Project]
  'edit-overlay': [overlay: OverlayObject]
  'publish-overlay': []
  'publish-project': []
  'close-popup': []
  'add-images': []
  'view-original-overlay': [overlayId: string]
  'delete-project': [project: Project]
  'delete-overlay': [overlay: OverlayObject]
}>()

const authStore = useAuthStore()
const { user } = storeToRefs(authStore)

// AI : Import pending modifications store for unified change detection
import { usePendingModificationsStore } from '@/stores/pinia/pendingModificationsStore'
const pendingModsStore = usePendingModificationsStore()

// AI : Check if project/overlay is published to backend (null status means not yet submitted)
const isPublishedToBackend = computed(() => {
  if (props.overlay) {
    return props.overlay.status === 'approved' || props.overlay.status === 'pending'
  }
  return props.project?.status !== null && (props.project?.status === 'approved' || props.project?.status === 'pending')
})

// AI : Check if overlay or project has changes that need to be published
// AI : Unified check: uses BOTH prop-based isModified AND pendingModificationsStore
const hasChanges = computed(() => {
  // AI : Check new unified store first (for caption/position changes)
  if (props.overlay && pendingModsStore.hasPendingModifications(props.overlay.id)) {
    return true
  }
  // AI : Check project's overlays in pending mods store
  if (props.project && pendingModsStore.getModificationCountForProject(props.project.id) > 0) {
    return true
  }
  // AI : Fallback to old prop-based isModified flags
  const overlayModified = props.overlay?.isModified ?? false
  const projectModified = props.project?.isModified ?? false
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
@import '../../../assets/info-card-shared.css';

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
  z-index: 1000;
}

/* AI : Triangle arrow pointing to the triggering element */
.unified-popup::before {
  content: '';
  position: absolute;
  top: -8px;
  width: 0;
  height: 0;
  border-left: 10px solid transparent;
  border-right: 10px solid transparent;
  border-bottom: 10px solid var(--p-surface-0);
}

/* AI : Positioning for overlay toolbar source - appears to the right of toolbar */
.popup-source-overlay {
  transform: translateY(20px);
}

/* AI : Triangle position for overlay source - positioned at left edge for now (user will translate) */
.popup-source-overlay::before {
  left: 10px;
}

/* AI : Positioning for project marker source - centered below marker */
.popup-source-marker {
  transform: translateX(-50%) translateY(20px);
}

/* AI : Triangle position for marker source - centered at top */
.popup-source-marker::before {
  left: 50%;
  transform: translateX(-50%);
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

.actions-section {
  margin-top: 1rem;
  display: flex;
  gap: 0.5rem;
  align-items: stretch;
}

.actions-section .flex-1 {
  flex: 1;
}
</style>
