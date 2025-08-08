<template>
  <div class="moderation-panel">
    <div class="panel-content">
      <div class="panel-header">
        <h3 class="panel-title">Pending Projects</h3>
        <Button
          icon="pi pi-undo"
          class="p-button-text p-button-rounded"
          @click="handleUndo"
          :disabled="!canUndo"
          v-tooltip.top="undoTooltip"
          aria-label="Undo last action"
        />
      </div>

      <Accordion
        v-if="projects.length > 0"
        :multiple="true"
      >
        <AccordionPanel
          v-for="project in projects"
          :value="project.id"
        >
          <AccordionHeader>
            <div class="project-name-section">
              <span class="project-name">{{ project.name }}</span>
              <Tag
                :value="project.status"
                :severity="getStatusSeverity(project.status)"
                class="project-status-tag"
              />
            </div>
          </AccordionHeader>
          <AccordionContent>

            <Card class="project-details-card">
              <!-- AI : Project description and metadata -->
              <template #content>
                <div class="project-content-wrapper">
                  <div class="project-info-section">
                    <div
                      v-if="project.description"
                      class="project-description"
                    >
                      <p>{{ project.description }}</p>
                    </div>
                    <div class="project-metadata">
                      <div class="metadata-item">
                        <i class="pi pi-calendar"></i>
                        <span>{{ formatRelativeTime(project.updatedAt) }}</span>
                      </div>
                      <div
                        class="metadata-item"
                        v-if="project.cityName"
                      >
                        <i class="pi pi-map-marker"></i>
                        <img
                          v-if="project.countryCode"
                          :src="getFlagUrl(project.countryCode)"
                          :alt="project.countryCode"
                          class="country-flag"
                          @error="hideFlagOnError"
                        />
                        <span>{{ getProjectLocationDisplay(project) }}</span>
                      </div>
                    </div>
                  </div>

                  <!-- AI : Project approval actions in the same grey card -->
                  <div
                    class="project-actions"
                    v-if="project.status === 'pending'"
                  >
                    <button
                      class="action-btn approve-btn"
                      @click="approveProject(project.id)"
                      v-tooltip.top="'Approve Project'"
                    >
                      <i class="pi pi-check"></i>
                    </button>
                    <button
                      class="action-btn reject-btn"
                      @click="rejectProject(project.id)"
                      v-tooltip.top="'Reject Project'"
                    >
                      <i class="pi pi-times"></i>
                    </button>
                  </div>
                </div>
              </template>
            </Card>

            <!-- AI : Project overlays - match LatestOverlaysPanel structure -->
            <div
              v-if="project.overlays && project.overlays.length > 0"
              class="flex flex-col gap-3 mt-4"
            >
              <div
                v-for="overlay in project.overlays"
                :key="overlay.id"
                class="flex items-center gap-3 bg-white border border-surface-300 rounded-lg p-3 transition-all hover:border-surface-400 hover:shadow-sm"
              >
                <!-- AI : Overlay thumbnail -->
                <div
                  class="w-15 h-15 rounded-md overflow-hidden bg-surface-100 flex items-center justify-center flex-shrink-0"
                >
                  <img
                    :src="getOverlayImageUrl(overlay.filename)"
                    :alt="overlay.name"
                    class="w-full h-full object-cover"
                    @error="handleImageError"
                  />
                  <div class="text-2xl font-bold text-surface-500">
                    {{ getOverlayLetter(overlay.name) }}
                  </div>
                </div>

                <!-- AI : Overlay info -->
                <div class="flex-1 min-w-0">
                  <p class="overlay-name">{{ overlay.name || 'Untitled' }}</p>
                  <div class="flex items-center gap-1.5 text-surface-600 text-xs mb-1">
                    <i class="pi pi-map-marker text-surface-500"></i>
                    <img
                      v-if="overlay.countryCode"
                      :src="getFlagUrl(overlay.countryCode)"
                      :alt="overlay.countryCode"
                      class="w-4 h-3 rounded-sm"
                      @error="hideFlagOnError"
                    />
                    <span class="truncate">{{ getOverlayLocationDisplay(overlay) }}</span>
                  </div>
                  <div class="text-xs text-surface-500 mb-2">
                    {{ formatRelativeTime(overlay.updatedAt) }}
                  </div>
                  <Tag
                    :value="overlay.status"
                    :severity="getStatusSeverity(overlay.status)"
                    class="overlay-status-tag"
                  />
                </div>

                <!-- AI : Overlay actions -->
                <div
                  class="flex flex-col gap-2"
                  v-if="overlay.status === 'pending'"
                >
                  <button
                    class="action-btn approve-btn"
                    @click="approveOverlay(overlay.id)"
                    v-tooltip.top="'Approve'"
                  >
                    <i class="pi pi-check"></i>
                  </button>
                  <button
                    class="action-btn reject-btn"
                    @click="rejectOverlay(overlay.id)"
                    v-tooltip.top="'Reject'"
                  >
                    <i class="pi pi-times"></i>
                  </button>
                </div>
              </div>
            </div>
          </AccordionContent>
        </AccordionPanel>
      </Accordion>

      <Card
        v-else
        class="empty-state-card"
      >
        <template #content>
          <div class="empty-state">
            <i
              class="pi pi-folder"
              style="font-size: 3rem; color: var(--surface-400); margin-bottom: 1rem;"
            ></i>
            <h4>No projects to moderate</h4>
            <p>All caught up!</p>
          </div>
        </template>
      </Card>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useModeration } from '../../composables/overlay/useModeration'
import { buildImageUrl, formatRelativeTime } from '../../utils'
import { navigateToOverlay } from '../../composables/overlay/useOverlayActions'
import Button from 'primevue/button'
import Accordion from 'primevue/accordion'
import AccordionPanel from 'primevue/accordionpanel'
import AccordionHeader from 'primevue/accordionheader'
import AccordionContent from 'primevue/accordioncontent'
import Card from 'primevue/card'
import Badge from 'primevue/badge'
import Tag from 'primevue/tag'

defineEmits<{
  close: []
  togglePanel: []
}>()

const { overlays, projects, recentActions, approveOverlay, rejectOverlay, approveProject, rejectProject, undoLastAction } = useModeration()

// AI : Computed properties for undo functionality
const canUndo = computed(() => recentActions.value.length > 0)

const undoTooltip = computed(() => {
  if (recentActions.value.length === 0) {
    return 'No recent actions to undo'
  }
  const lastAction = recentActions.value[0]
  return `Undo ${lastAction.newStatus} action for ${lastAction.itemType}: "${lastAction.itemName}"`
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
function getOverlayLetter(name: string): string {
  return name?.charAt(0)?.toUpperCase() || 'O'
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

// AI : Get project location display (city, country)
function getProjectLocationDisplay(project: any): string {
  if (project.cityName && project.countryName) {
    return `${project.cityName}, ${project.countryName}`
  } else if (project.cityName) {
    return project.cityName
  } else if (project.countryName) {
    return project.countryName
  }
  return 'Unknown Location'
}

// AI : Get overlay location display (city, country)
function getOverlayLocationDisplay(overlay: any): string {
  if (overlay.cityName && overlay.countryName) {
    return `${overlay.cityName}, ${overlay.countryName}`
  } else if (overlay.cityName) {
    return overlay.cityName
  } else if (overlay.countryName) {
    return overlay.countryName
  }
  return 'Unknown Location'
}

// AI : Get badge severity based on status
function getStatusSeverity(status: string): string {
  switch (status) {
    case 'approved':
      return 'success'
    case 'rejected':
      return 'danger'
    case 'pending':
      return 'warning'
    default:
      return 'info'
  }
}

// AI : Handle overlay zoom navigation
async function handleOverlayZoom(overlay: any) {
  try {
    await navigateToOverlay(overlay.id)
  } catch (error) {
    console.error('AI : Failed to navigate to overlay:', error)
  }
}
</script>

<style scoped>
.moderation-panel {
  height: 100%;
  display: flex;
  flex-direction: column;
}

.panel-content {
  flex: 1;
  overflow-y: auto;
  padding: 1.5rem;
  max-height: 100vh;
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

/* AI : Project header customization - simplified */

.project-name-section {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.project-name {
  font-size: 1.125rem;
  font-weight: 600;
  color: var(--p-surface-900);
  margin: 0;
}

.project-status-tag {
  font-size: 0.75rem;
  text-transform: lowercase;
}

/* AI : Project content layout */
.project-content-wrapper {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 1rem;
}

.project-info-section {
  flex: 1;
}

.project-actions {
  display: flex;
  gap: 0.5rem;
  flex-shrink: 0;
}


/* AI : Project details */
.project-details-card {
  margin-bottom: 1rem;
  box-shadow: none;
  border: none;
  background-color: #f8f9fa;
}

.project-description p {
  margin: 0 0 1rem 0;
  color: var(--p-surface-700);
  line-height: 1.5;
}

.project-metadata {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

/* AI : Metadata items */
.metadata-item {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  color: var(--p-surface-600);
  font-size: 0.875rem;
}

.metadata-item i {
  color: var(--p-surface-500);
}

.country-flag {
  width: 1rem;
  height: 0.75rem;
  border-radius: 0.125rem;
}

/* AI : Overlay name styling to match LatestOverlaysPanel */
.overlay-name {
  font-weight: 600;
  color: var(--p-surface-900);
  font-size: 0.875rem;
  margin-bottom: 0.25rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* AI : Status tag styling */
.overlay-status-tag {
  font-size: 0.75rem;
  text-transform: lowercase;
}

/* AI : Clean action buttons matching prototype */
.action-btn {
  width: 32px;
  height: 32px;
  border: 1px solid #e5e7eb;
  border-radius: 6px;
  background: white;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all 0.15s ease;
  font-size: 0.875rem;
}

.action-btn:hover {
  border-color: #d1d5db;
  background-color: #f9fafb;
}

.approve-btn {
  color: #059669;
}

.approve-btn:hover {
  background-color: #ecfdf5;
  border-color: #a7f3d0;
}

.reject-btn {
  color: #dc2626;
}

.reject-btn:hover {
  background-color: #fef2f2;
  border-color: #fecaca;
}

/* AI : Empty state */
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 2rem;
  text-align: center;
  color: var(--p-surface-600);
}

.empty-state h4 {
  margin: 0.5rem 0;
  color: var(--p-surface-700);
}

.empty-state p {
  margin: 0;
  color: var(--p-surface-500);
}

/* AI : Mobile responsive */
@media (max-width: 768px) {
  .panel-content {
    padding: 0.75rem;
  }

  .project-info {
    flex-direction: column;
    align-items: flex-start;
    gap: 0.75rem;
  }

  .overlay-content {
    gap: 1rem;
  }

  .overlay-thumbnail {
    width: 3.5rem;
    height: 3.5rem;
  }
}
</style>
