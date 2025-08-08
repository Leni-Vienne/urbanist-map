<template>
  <div class="moderation-panel">
    <div class="panel-content">
      <div class="panel-header">
        <h3 class="panel-title">Pending Overlays</h3>
        <Button
          icon="pi pi-undo"
          class="p-button-text p-button-rounded undo-button"
          @click="handleUndo"
          :disabled="!canUndo"
          v-tooltip.top="undoTooltip"
          aria-label="Undo last action"
        />
      </div>
      
      <div class="flex flex-col gap-3" v-if="overlays.length > 0">
        <div 
          v-for="overlay in overlays" 
          :key="overlay.id"
          class="overlay-card"
        >
          <!-- AI : Overlay thumbnail image -->
          <div class="overlay-thumbnail">
            <img 
              :src="getOverlayImageUrl(overlay.filename)" 
              :alt="overlay.name"
              class="thumbnail-image"
              @error="handleImageError"
            />
            <!-- AI : Fallback letter if image fails -->
            <div class="thumbnail-fallback">
              {{ getOverlayLetter(overlay.name) }}
            </div>
          </div>
          
          <!-- AI : Overlay info -->
          <div class="overlay-info">
            <p class="overlay-name">{{ overlay.name || 'Untitled' }}</p>
            <div class="overlay-project" v-if="overlay.projectName">
              <i class="pi pi-folder"></i>
              <span>{{ overlay.projectName }}</span>
            </div>
            <div class="overlay-location">
              <i class="pi pi-map-marker"></i>
              <img 
                v-if="overlay.countryCode" 
                :src="getFlagUrl(overlay.countryCode)" 
                :alt="overlay.countryCode"
                class="country-flag"
                @error="hideFlagOnError"
              />
              <span>{{ getLocationDisplay(overlay) }}</span>
            </div>
            <div class="overlay-time">
              {{ formatRelativeTime(overlay.updatedAt) }}
            </div>
          </div>
          
          <!-- AI : Action buttons with modern styling -->
          <div class="overlay-actions">
            <button 
              class="action-button approve-button"
              @click="approveOverlay(overlay.id)"
              v-tooltip.top="'Approve'"
            >
              <i class="pi pi-check"></i>
            </button>
            <button 
              class="action-button reject-button"
              @click="rejectOverlay(overlay.id)"
              v-tooltip.top="'Reject'"
            >
              <i class="pi pi-times"></i>
            </button>
          </div>
        </div>
      </div>
      
      <div v-else class="empty-state">
        <i class="pi pi-eye text-5xl text-surface-400 mb-4"></i>
        <p class="text-base mb-2">No overlays to moderate.</p>
        <p class="text-sm">All caught up!</p>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useModeration } from '../../composables/overlay/useModeration'
import { navigateToOverlay } from '../../composables/overlay/useOverlayActions'
import { buildImageUrl, formatRelativeTime } from '../../utils'
import Button from 'primevue/button'

defineEmits<{
  close: []
  togglePanel: []
}>()

const { overlays, recentActions, approveOverlay, rejectOverlay, undoLastAction } = useModeration()

// AI : Computed properties for undo functionality
const canUndo = computed(() => recentActions.value.length > 0)

const undoTooltip = computed(() => {
  if (recentActions.value.length === 0) {
    return 'No recent actions to undo'
  }
  const lastAction = recentActions.value[0]
  return `Undo ${lastAction.newStatus} action for "${lastAction.overlayName}"`
})

const handleUndo = async () => {
  const success = await undoLastAction()
  if (!success) {
    console.error('Failed to undo last action')
  }
}

// AI : Get overlay image URL using the utility function
function getOverlayImageUrl(filename: string): string {
  return buildImageUrl(filename)
}

// AI : Get first letter of overlay name for fallback
function getOverlayLetter(filename: string): string {
  return filename?.charAt(0)?.toUpperCase() || 'O'
}

// AI : Handle image loading errors
function handleImageError(event: Event) {
  const target = event.target as HTMLImageElement
  target.style.display = 'none'
}

// AI : Get flag URL for country
function getFlagUrl(countryCode: string): string {
  return `https://flagcdn.com/16x12/${countryCode.toLowerCase()}.png`
}

// AI : Hide flag on error
function hideFlagOnError(event: Event) {
  const target = event.target as HTMLImageElement
  target.style.display = 'none'
}

// AI : Get location display (city, country)
function getLocationDisplay(overlay: any): string {
  if (overlay.city && overlay.countryName) {
    return `${overlay.city}, ${overlay.countryName}`
  } else if (overlay.city) {
    return overlay.city
  } else if (overlay.countryName) {
    return overlay.countryName
  }
  return 'Unknown Location'
}
</script>

<style scoped>
/* AI : Modern card-based design inspired by the reference site */
.moderation-panel {
  height: 100%;
  display: flex;
  flex-direction: column;
}

.panel-content {
  flex: 1;
  overflow-y: auto;
  padding: 1.5rem;
}

.panel-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 1.5rem;
}

.panel-title {
  margin: 0;
  font-size: 1.25rem;
  font-weight: 600;
  color: var(--p-surface-800);
}

.undo-button {
  color: var(--p-primary-600);
}

.undo-button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* AI : Modern card design */
.overlay-card {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  background: white;
  border: 1px solid var(--p-surface-300);
  border-radius: 0.5rem;
  padding: 0.75rem;
  transition: all 0.2s ease;
}

.overlay-card:hover {
  border-color: var(--p-surface-400);
  box-shadow: 0 1px 3px 0 rgba(0, 0, 0, 0.1), 0 1px 2px 0 rgba(0, 0, 0, 0.06);
}

/* AI : Thumbnail styling */
.overlay-thumbnail {
  width: 3.75rem;
  height: 3.75rem;
  border-radius: 0.375rem;
  overflow: hidden;
  background-color: var(--p-surface-100);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  position: relative;
}

.thumbnail-image {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.thumbnail-fallback {
  font-size: 1.5rem;
  font-weight: bold;
  color: var(--p-surface-500);
}

/* AI : Info section */
.overlay-info {
  flex: 1;
  min-width: 0;
}

.overlay-name {
  font-weight: 600;
  color: var(--p-surface-900);
  font-size: 0.875rem;
  margin-bottom: 0.25rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.overlay-project {
  display: flex;
  align-items: center;
  gap: 0.375rem;
  color: var(--p-blue-600);
  font-size: 0.75rem;
  margin-bottom: 0.25rem;
  font-weight: 500;
}

.overlay-project i {
  color: var(--p-blue-500);
}

.overlay-location {
  display: flex;
  align-items: center;
  gap: 0.375rem;
  color: var(--p-surface-600);
  font-size: 0.75rem;
  margin-bottom: 0.25rem;
}

.overlay-location i {
  color: var(--p-surface-500);
}

.overlay-location span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.country-flag {
  width: 1rem;
  height: 0.75rem;
  border-radius: 0.125rem;
}

.overlay-time {
  font-size: 0.75rem;
  color: var(--p-surface-500);
}

/* AI : Modern action buttons */
.overlay-actions {
  display: flex;
  gap: 0.375rem;
  flex-shrink: 0;
}

.action-button {
  width: 2rem;
  height: 2rem;
  border-radius: 0.375rem;
  border: 1px solid;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all 0.2s ease;
  font-size: 0.875rem;
}

.approve-button {
  background-color: var(--p-green-50);
  border-color: var(--p-green-200);
  color: var(--p-green-600);
}

.approve-button:hover {
  background-color: var(--p-green-100);
  color: var(--p-green-700);
}

.reject-button {
  background-color: var(--p-red-50);
  border-color: var(--p-red-200);
  color: var(--p-red-600);
}

.reject-button:hover {
  background-color: var(--p-red-100);
  color: var(--p-red-700);
}


/* AI : Empty state styling */
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 3rem;
  text-align: center;
  color: var(--p-surface-600);
}

/* AI : Mobile responsive adjustments */
@media (max-width: 768px) {
  .panel-content {
    padding: 0.75rem;
  }
  
  .overlay-card {
    padding: 1rem;
    gap: 1rem;
  }
  
  .overlay-thumbnail {
    width: 4rem;
    height: 4rem;
  }
  
  .overlay-name {
    font-size: 1rem;
  }
  
  .overlay-location,
  .overlay-time {
    font-size: 0.875rem;
  }
  
  .action-button {
    width: 2.5rem;
    height: 2.5rem;
  }
  
  .overlay-actions {
    gap: 0.5rem;
  }
}
</style>
