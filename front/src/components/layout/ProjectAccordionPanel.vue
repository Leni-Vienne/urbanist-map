<template>
  <div :class="panelClass">
    <div class="panel-content">
      <div class="panel-header">
        <h2 class="panel-title">{{ title }}</h2>
        <div
          v-if="$slots['header-actions']"
          class="header-actions"
        >
          <slot name="header-actions"></slot>
        </div>
      </div>

      <Accordion
        v-if="projects.length > 0"
        :multiple="true"
        v-model:value="activeAccordionPanels"
      >
        <AccordionPanel
          v-for="project in projects"
          :key="project.id"
          :value="project.id"
        >
          <AccordionHeader>
            <div class="accordion-header-content">
              <span class="project-name">{{ project.name }}</span>
              <Tag
                :value="project.status"
                :severity="getStatusSeverity(project.status)"
                class="project-status-tag"
                rounded
              />

            </div>
          </AccordionHeader>
          <AccordionContent>
            <Card
              class="project-details-card"
              :class="{ 'marker-project-card': project.isDevelopment }"
              @click="project.isDevelopment ? handleDevelopmentProjectClick(project) : null"
            >
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
                        <i class="pi pi-clock"></i>
                        <span>Updated {{ formatRelativeTime(project.updatedAt) }}</span>
                      </div>
                      <div
                        class="metadata-item"
                        v-if="getProjectLocation(project)"
                      >
                        <i class="pi pi-map-marker"></i>
                        <span>{{ getProjectLocation(project) }}</span>
                      </div>
                      <div v-if="!project.isDevelopment" class="metadata-item">
                        <i class="pi pi-images"></i>
                        <span>{{ project.overlayCount || (project.overlays ? project.overlays.length : 0) }}
                          {{ $t('overlay.overlayImages') }}</span>
                      </div>
                      <div
                        class="metadata-item"
                        v-if="project.startDate || project.endDate"
                      >
                        <i class="pi pi-calendar"></i>
                        <span>{{ formatProjectDateRange(project.startDate, project.endDate) }}</span>
                      </div>
                      <div
                        class="metadata-item"
                        v-if="project.sourceUrl"
                      >
                        <i class="pi pi-link"></i>
                        <a
                          :href="project.sourceUrl"
                          target="_blank"
                          class="source-link"
                        >
                          {{ formatSourceUrl(project.sourceUrl) }}
                        </a>
                      </div>
                    </div>
                  </div>

                  <!-- AI : Project actions slot for moderation panel - match overlay layout -->
                  <div
                    v-if="$slots['project-actions']"
                    class="flex flex-col gap-2"
                  >
                    <slot
                      name="project-actions"
                      :project="project"
                    ></slot>
                  </div>

                  <!-- AI : Zoom icon for development projects -->
                  <button
                    v-if="project.isDevelopment && !$slots['project-actions']"
                    class="bg-surface-50 border border-surface-200 rounded-md w-8 h-8 flex items-center justify-center text-surface-500 hover:bg-surface-100 hover:text-surface-600 transition-all flex-shrink-0"
                    @click.stop="handleDevelopmentProjectClick(project)"
                  >
                    <i class="pi pi-search"></i>
                    <span class="sr-only">Zoom to {{ project.name }}</span>
                  </button>
                </div>

                <!-- AI : Project change requests -->
                <div v-if="getProjectChangeRequests(project.id).length > 0" class="project-change-requests">
                  <h3 class="change-requests-title">{{ isMyContributionsPanel ? 'Your Pending Changes' : 'Pending Changes' }}</h3>
                  <p v-if="isMyContributionsPanel" class="change-requests-subtitle">A moderator needs to review and approve these changes</p>
                  <div class="change-requests-list">
                    <div 
                      v-for="change in getProjectChangeRequests(project.id)" 
                      :key="change.id"
                      class="change-item"
                    >
                      <div class="change-content">
                        <div class="change-field">
                          <strong>{{ change.fieldName }}:</strong>
                          <div class="change-values">
                            <span class="old-value">{{ formatValue(change.oldValue) }}</span>
                            <i class="pi pi-arrow-right"></i>
                            <span class="new-value">{{ formatValue(change.newValue) }}</span>
                          </div>
                          <div v-if="change.changeReason" class="change-reason">
                            <em>Reason: {{ change.changeReason }}</em>
                          </div>
                          <div class="change-date">
                            <em>Requested: {{ new Date(change.createdAt).toLocaleString() }}</em>
                          </div>
                        </div>
                        <div v-if="$slots['change-actions']" class="change-actions">
                          <slot
                            name="change-actions"
                            :change="change"
                          ></slot>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </template>
            </Card>

            <!-- AI : Project overlays with borderless design -->
            <div
              v-if="shouldShowOverlays(project) && project.overlays && project.overlays.length > 0"
              class="flex flex-col mt-4"
            >
              <div
                v-for="overlay in project.overlays"
                :key="overlay.id"
                class="overlay-card-wrapper"
                :class="{ 'has-changes': getOverlayChangeRequests(overlay.id).length > 0 }"
              >
                <div class="overlay-card" @click="handleOverlayClick(overlay)">
                  <!-- AI : Overlay thumbnail -->
                  <div
                    class="w-15 h-15 rounded-md overflow-hidden bg-surface-100 flex items-center justify-center flex-shrink-0"
                  >
                    <img
                      v-if="shouldShowOverlays(project) && !imageErrors[overlay.id]"
                      :src="getOverlayImageUrl(overlay.filename, overlay.status)"
                      :alt="overlay.name"
                      class="w-full h-full object-cover"
                      @error="(event) => handleImageError(event, overlay.id)"
                      @load="(event) => handleImageLoad(event, overlay.id)"
                    />
                    <i
                      v-if="imageErrors[overlay.id]"
                      class="pi pi-image text-2xl text-surface-400"
                    ></i>
                  </div>

                  <!-- AI : Overlay info -->
                  <div class="flex-1 min-w-0">
                    <div class="flex items-center gap-2 mb-1">
                      <p class="overlay-name">{{ overlay.name || 'Untitled' }}</p>
                    </div>
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
                      rounded
                    />
                  </div>

                  <!-- AI : Overlay action buttons slot or default zoom button -->
                  <div
                    v-if="$slots['overlay-actions']"
                    class="flex flex-col gap-2"
                  >
                    <slot
                      name="overlay-actions"
                      :overlay="overlay"
                      :project="project"
                    ></slot>
                  </div>
                  <button
                    v-else
                    class="bg-surface-50 border border-surface-200 rounded-md w-8 h-8 flex items-center justify-center text-surface-500 hover:bg-surface-100 hover:text-surface-600 transition-all flex-shrink-0"
                    @click.stop="handleOverlayClick(overlay)"
                  >
                    <i class="pi pi-search"></i>
                    <span class="sr-only">Zoom to {{ overlay.name }}</span>
                  </button>
                </div>

                <!-- AI : Overlay change requests - visually connected to overlay -->
                <div v-if="getOverlayChangeRequests(overlay.id).length > 0" class="overlay-change-requests">
                  <div class="change-requests-header">
                    <div class="change-indicator">
                      <i class="pi pi-exclamation-triangle text-orange-500"></i>
                      <span class="change-header-text">{{ isMyContributionsPanel ? 'Your Pending Changes' : 'Pending Changes' }} for "{{ overlay.name || 'Untitled' }}"</span>
                    </div>
                    <p v-if="isMyContributionsPanel" class="change-requests-subtitle">A moderator needs to review and approve these changes</p>
                  </div>
                  <div class="change-requests-list">
                    <div 
                      v-for="change in getOverlayChangeRequests(overlay.id)" 
                      :key="change.id"
                      class="change-item"
                    >
                      <div class="change-content">
                        <div class="change-field">
                          <strong>{{ change.fieldName }}:</strong>
                          <div class="change-values">
                            <span class="old-value">{{ formatValue(change.oldValue) }}</span>
                            <i class="pi pi-arrow-right"></i>
                            <span class="new-value">{{ formatValue(change.newValue) }}</span>
                          </div>
                          <div v-if="change.changeReason" class="change-reason">
                            <em>Reason: {{ change.changeReason }}</em>
                          </div>
                          <div class="change-date">
                            <em>Requested: {{ new Date(change.createdAt).toLocaleString() }}</em>
                          </div>
                        </div>
                        <div v-if="$slots['change-actions']" class="change-actions">
                          <slot
                            name="change-actions"
                            :change="change"
                          ></slot>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </AccordionContent>
        </AccordionPanel>
      </Accordion>

      <!-- AI : Empty state -->
      <div
        v-else-if="!isLoading"
        class="flex flex-col items-center justify-center p-12 text-center text-surface-600"
      >
        <slot name="empty-state">
          <i class="pi pi-folder text-5xl text-surface-400 mb-4"></i>
          <p class="text-base mb-2">{{ emptyMessage }}</p>
          <p class="text-sm">{{ emptySubMessage }}</p>
        </slot>
      </div>

      <!-- AI : Loading state -->
      <div
        v-if="isLoading"
        class="flex flex-col items-center justify-center p-12 text-center text-surface-600"
      >
        <i class="pi pi-spin pi-spinner text-2xl mb-4"></i>
        <p>Loading projects...</p>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { buildThumbnailUrl, formatRelativeTime } from '../../utils'
import { navigateToOverlayWithCity, navigateToDevelopmentProject } from '@composables/navigation/useOverlayNavigation'
import { navigateToOverlay } from '@composables/overlay/useOverlay'
import { toggleEditMode } from '@composables/overlay/useOverlayModes'
import { useOverlayStore } from '@stores/pinia/overlayStore'
import { useMapStore } from '@stores/pinia/mapStore'
import type { ProjectForModeration, OverlayForModeration } from '@types'
import { useToast } from '@composables/ui/useToast'
import Tag from 'primevue/tag'
import Accordion from 'primevue/accordion'
import AccordionPanel from 'primevue/accordionpanel'
import AccordionHeader from 'primevue/accordionheader'
import AccordionContent from 'primevue/accordioncontent'
import Card from 'primevue/card'
import type { PendingChangeRequest } from '../../types/api'

// AI : Props interface
interface Props {
  projects: ProjectForModeration[]
  isLoading: boolean
  title: string
  panelClass: string
  emptyMessage?: string
  emptySubMessage?: string
  changeRequests?: PendingChangeRequest[]
}

const props = withDefaults(defineProps<Props>(), {
  emptyMessage: 'No projects found.',
  emptySubMessage: 'Create your first construction project!',
  changeRequests: () => []
})

// AI : Reactive state for image errors and expanded panels
const imageErrors = ref<Record<string, boolean>>({})
const activeAccordionPanels = ref<string[]>([])
const toast = useToast()

// AI : Computed expanded panels set for easier checking
const expandedPanels = computed(() => new Set(activeAccordionPanels.value))

// AI : Check if this is the My Contributions panel
const isMyContributionsPanel = computed(() => props.panelClass === 'my-contributions-panel')

// AI : Get flag URL for country
function getFlagUrl(countryCode: string): string {
  return `https://flagcdn.com/16x12/${countryCode.toLowerCase()}.png`
}

// AI : Hide flag on error
function hideFlagOnError(event: Event) {
  const target = event.target as HTMLImageElement
  target.style.display = 'none'
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

// AI : Get project location display - always show country when available
function getProjectLocation(project: ProjectForModeration): string {
  const cityName = project.cityName
  const countryName = project.countryName

  if (cityName && countryName) {
    return `${cityName}, ${countryName}`
  } else if (cityName) {
    return cityName
  } else if (countryName) {
    return countryName
  }
  return ''
}

// AI : Get overlay thumbnail URL using the utility function
// Thumbnails are much smaller (~3KB vs full image) for efficient list display
// For pending overlays, always use backend URL (not migrated to R2 yet)
function getOverlayImageUrl(filename: string, status?: string): string {
  const forceBackendUrl = status === 'pending';
  return buildThumbnailUrl(filename, forceBackendUrl)
}


// AI : Handle image loading errors
function handleImageError(event: Event, overlayId: string) {
  imageErrors.value[overlayId] = true
  const target = event.target as HTMLImageElement
  target.style.display = 'none'
}

// AI : Handle image loading success
function handleImageLoad(event: Event, overlayId: string) {
  imageErrors.value[overlayId] = false
}

// AI : Get overlay location display (city, country) - avoid duplication
function getOverlayLocationDisplay(overlay: OverlayForModeration): string {
  // AI : Try different property combinations to avoid duplication
  const cityName = overlay.cityName
  const countryName = overlay.countryName

  if (cityName && countryName) {
    // AI : Avoid duplication if city name already contains country
    if (cityName.includes(countryName)) {
      return cityName
    }
    return `${cityName}, ${countryName}`
  } else if (cityName) {
    return cityName
  } else if (countryName) {
    return countryName
  }
  return 'Unknown Location'
}

// AI : Format project dates nicely
function formatProjectDate(date: Date | null): string {
  if (!date) return ''
  return new Date(date).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  })
}

// AI : Format project date range on single line with dash
function formatProjectDateRange(startDate: Date | null, endDate: Date | null): string {
  const start = startDate ? formatProjectDate(startDate) : null
  const end = endDate ? formatProjectDate(endDate) : null

  if (start && end) {
    return `${start} - ${end}`
  } else if (start) {
    return `Starts ${start}`
  } else if (end) {
    return `Ends ${end}`
  }
  return ''
}

// AI : Format source URL for display
function formatSourceUrl(url: string): string {
  if (!url) return ''
  try {
    const urlObj = new URL(url)
    return urlObj.hostname
  } catch {
    return url.length > 30 ? url.substring(0, 30) + '...' : url
  }
}


// AI : Check if overlays should be shown (only for expanded panels)
function shouldShowOverlays(project: ProjectForModeration): boolean {
  return expandedPanels.value.has(project.id)
}

// AI : Handle overlay click - simulate clicking country marker → city marker → overlay
async function handleOverlayClick(overlay: OverlayForModeration) {
  try {
    const overlayStore = useOverlayStore()
    const mapStore = useMapStore()

    // AI : If overlay is pending, switch to edit mode first so it becomes visible
    if (overlay.status === 'pending' && !overlayStore.isEditMode) {
      await toggleEditMode()

      toast.add({
        severity: 'info',
        summary: 'Switched to Edit Mode',
        detail: 'Pending overlays are only visible in edit mode',
        life: 3000
      })

      // AI : Clear city cache to force reload with pending overlays visible
      if (overlay.cityId) {
        mapStore.clearCityProjectsCache(overlay.cityId)
        mapStore.clearCityDevelopmentProjectsCache(overlay.cityId)
      }

      // AI : Wait for edit mode transition to complete and overlays to re-render
      await new Promise(resolve => setTimeout(resolve, 100))
    }

    // AI : If overlay has city info, navigate via city (loads city markers and overlays first)
    if (overlay.cityId && overlay.cityName) {
      await navigateToOverlayWithCity(overlay.id, overlay.cityId, overlay.cityName, overlay.countryCode ?? undefined)
    } else {
      // AI : Fallback to direct navigation if no city info
      await navigateToOverlay(overlay.id)
    }
  } catch (error) {
    console.error('Failed to navigate to overlay:', error)
    toast.add({
      severity: 'error',
      summary: 'Navigation Failed',
      detail: error instanceof Error ? error.message : 'Failed to navigate to overlay',
      life: 3000
    })
  }
}

// AI : Handle development project click - zoom to marker location
async function handleDevelopmentProjectClick(project: ProjectForModeration) {
  try {
    if (!project.lat || !project.lng) {
      toast.add({
        severity: 'warn',
        summary: 'No Location',
        detail: 'This development project has no coordinates',
        life: 3000
      })
      return
    }

    if (!project.cityId || !project.cityName) {
      toast.add({
        severity: 'warn',
        summary: 'Missing City Info',
        detail: 'Cannot navigate without city information',
        life: 3000
      })
      return
    }

    await navigateToDevelopmentProject(
      project.lat,
      project.lng,
      project.cityId,
      project.cityName,
      project.countryCode ?? undefined
    )

    toast.add({
      severity: 'success',
      summary: 'Navigated',
      detail: `Viewing ${project.name}`,
      life: 2000
    })
  } catch (error) {
    console.error('Failed to navigate to development project:', error)
    toast.add({
      severity: 'error',
      summary: 'Navigation Failed',
      detail: error instanceof Error ? error.message : 'Failed to navigate to development project',
      life: 3000
    })
  }
}

// AI : Get change requests for a specific project (only for approved projects)
function getProjectChangeRequests(projectId: string): PendingChangeRequest[] {
  const project = props.projects.find(p => p.id === projectId)
  // AI : Only show change requests for approved projects, not pending ones
  if (!project || project.status === 'pending') {
    return []
  }
  return props.changeRequests?.filter(
    request => request.entityType === 'project' && request.entityId === projectId
  ) ?? []
}

// AI : Get change requests for a specific overlay (only for approved overlays)
function getOverlayChangeRequests(overlayId: string): PendingChangeRequest[] {
  // AI : Find the overlay in the projects data
  let overlay = null
  for (const project of props.projects) {
    if (project.overlays) {
      overlay = project.overlays.find((o: OverlayForModeration) => o.id === overlayId)
      if (overlay) break
    }
  }
  // AI : Only show change requests for approved overlays, not pending ones
  if (!overlay || overlay.status === 'pending') {
    return []
  }
  return props.changeRequests?.filter(
    request => request.entityType === 'overlay' && request.entityId === overlayId
  ) ?? []
}

// AI : Format values for display
function formatValue(value: unknown): string {
  if (value === null || value === undefined || value === '') {
    return 'Not set'
  }
  if (typeof value === 'object') {
    return JSON.stringify(value, null, 2)
  }
  return String(value)
}
</script>

<style scoped>
/* AI : Style the accordion header content wrapper for proper alignment */
.accordion-header-content {
  display: flex !important;
  align-items: center !important;
  justify-content: space-between !important;
  width: 100% !important;
  gap: 0.5rem !important;
}

/* AI : Add extra space to the right of status tags and capitalize first letter */
.project-status-tag,
.overlay-status-tag {
  margin-right: 0.5rem;
  text-transform: capitalize;
}

/* AI : Component wrapper */
.my-contributions-panel,
.moderation-panel {
  height: 100%;
  display: flex;
  flex-direction: column;
}

.panel-content {
  flex: 1;
  padding: 1rem 0 1rem 1rem;
  overflow: visible;
}

.panel-header {
  position: sticky;
  top: 0;
  background-color: var(--p-surface-0);
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 1.5rem;
  padding: 1rem 1rem 0.75rem 0;
  border-bottom: 2px solid var(--p-primary-100);
}

.panel-title {
  margin: 0;
  font-size: 1.1rem;
  font-weight: 600;
  color: var(--p-surface-900);
  letter-spacing: -0.025em;
}

.header-actions {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

/* AI : Project content wrapper flex layout like overlay cards */
.project-content-wrapper {
  display: flex;
  align-items: flex-start;
  gap: 0.75rem;
}

/* AI : Development project card styling - similar to overlay cards */
.marker-project-card {
  cursor: pointer;
  transition: all 0.15s ease;
}

.marker-project-card:hover {
  background-color: var(--p-surface-50) !important;
}

/* AI : Improved project information styling */
.project-info-section {
  flex: 1;
  min-width: 0;
}

.project-description {
  margin-bottom: 1rem;
}

.project-description p {
  font-size: 0.875rem;
  line-height: 1.5;
  color: var(--p-surface-700);
  margin: 0;
}

.project-metadata {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.metadata-item {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.8125rem;
  color: var(--p-surface-600);
}

.metadata-item i {
  color: var(--p-surface-500);
  font-size: 0.75rem;
  width: 14px;
  flex-shrink: 0;
}

.metadata-item span {
  line-height: 1.4;
}

.source-link {
  color: var(--p-primary-600);
  text-decoration: none;
  font-size: 0.8125rem;
  line-height: 1.4;
}

.source-link:hover {
  color: var(--p-primary-700);
  text-decoration: underline;
}


/* AI : Overlay card wrapper */
.overlay-card-wrapper {
  display: flex;
  flex-direction: column;
  transition: all 0.15s ease;
}

/* AI : Visual connection for overlays with changes */
.overlay-card-wrapper.has-changes {
  border-left: 3px solid var(--p-orange-400);
  background: var(--p-orange-50);
  border-radius: 4px;
  margin: 0.25rem 0;
}

/* AI : Borderless overlay cards like the prototype */
.overlay-card {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 1rem;
  background: transparent;
  cursor: pointer;
  transition: all 0.15s ease;
  border-radius: 0;
}

.overlay-card:hover {
  background-color: var(--p-surface-50);
}

/* AI : Overlay card in wrapper with changes */
.overlay-card-wrapper.has-changes .overlay-card {
  background: transparent;
}

.overlay-card-wrapper.has-changes .overlay-card:hover {
  background-color: var(--p-orange-100);
}

/* AI : Overlay name styling to match LatestOverlaysPanel */
.overlay-card .overlay-name {
  font-size: 0.9375rem;
  font-weight: 700;
  color: var(--p-surface-900);
  margin: 0 0 0.25rem 0;
  line-height: 1.3;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* AI : Change requests styling */
.project-change-requests {
  margin-top: 1rem;
  padding: 0.75rem;
  background: var(--p-surface-50);
  border: 1px solid var(--p-surface-200);
  border-radius: 6px;
}

.overlay-change-requests {
  padding: 0.75rem 1rem;
  background: var(--p-orange-25);
  border-top: 1px solid var(--p-orange-200);
}

.change-requests-title {
  margin: 0 0 0.75rem 0;
  font-size: 0.875rem;
  font-weight: 600;
  color: var(--p-surface-700);
}

.change-requests-subtitle {
  margin: 0.5rem 0 0 0;
  font-size: 0.75rem;
  color: var(--p-surface-500);
  font-style: italic;
}

/* AI : Change requests header for overlays */
.change-requests-header {
  margin-bottom: 0.75rem;
}

.change-indicator {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.change-header-text {
  font-size: 0.8125rem;
  font-weight: 600;
  color: var(--p-orange-700);
}

.change-requests-list {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.change-item {
  background: white;
  border: 1px solid var(--p-surface-200);
  border-radius: 4px;
  padding: 0.5rem;
}

.change-content {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.change-field {
  flex: 1;
  min-width: 0;
}

.change-field strong {
  color: var(--p-surface-700);
  font-size: 0.8125rem;
}

.change-values {
  display: flex;
  align-items: flex-start;
  gap: 0.5rem;
  margin: 0.25rem 0;
  font-family: 'Courier New', monospace;
  font-size: 0.75rem;
  flex-wrap: wrap;
}

.old-value {
  color: #dc2626;
  background: #fef2f2;
  padding: 0.125rem 0.25rem;
  border-radius: 3px;
  word-break: break-word;
  max-width: 150px;
}

.new-value {
  color: #059669;
  background: #ecfdf5;
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

.change-actions {
  display: flex;
  gap: 0.25rem;
  justify-content: flex-end;
  flex-shrink: 0;
}
</style>
