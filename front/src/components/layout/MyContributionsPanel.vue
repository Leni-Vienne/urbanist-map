<template>
  <div class="my-contributions-panel">
    <div class="panel-content">
      <div class="panel-header">
        <h3 class="panel-title">My Contributions</h3>
        <div class="filter-controls">
          <div class="field-checkbox">
            <Checkbox v-model="showApprovedRejected" inputId="showApprovedRejected" binary />
            <label for="showApprovedRejected">Show approved/rejected</label>
          </div>
        </div>
      </div>
      
      <Accordion
        v-if="filteredProjects.length > 0"
        :multiple="true"
      >
        <AccordionPanel
          v-for="project in filteredProjects"
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
                        v-if="project.city?.name"
                      >
                        <i class="pi pi-map-marker"></i>
                        <img
                          v-if="project.city?.countryCode"
                          :src="getFlagUrl(project.city.countryCode)"
                          :alt="project.city.countryCode"
                          class="country-flag"
                          @error="hideFlagOnError"
                        />
                        <span>{{ project.city.name }}</span>
                      </div>
                      <div class="metadata-item">
                        <i class="pi pi-images"></i>
                        <span>{{ project.overlayCount }} overlays</span>
                      </div>
                    </div>
                  </div>
                </div>
              </template>
            </Card>

            <!-- AI : Project overlays - match ModerationPanel structure -->
            <div
              v-if="project.overlays && project.overlays.length > 0"
              class="flex flex-col gap-3 mt-4"
            >
              <div
                v-for="overlay in project.overlays"
                :key="overlay.id"
                class="flex items-center gap-3 bg-white border border-surface-300 rounded-lg p-3 cursor-pointer transition-all hover:border-surface-400 hover:shadow-sm"
                @click="handleOverlayClick(overlay)"
              >
                <!-- AI : Overlay thumbnail -->
                <div
                  class="w-15 h-15 rounded-md overflow-hidden bg-surface-100 flex items-center justify-center flex-shrink-0"
                >
                  <img
                    :src="getOverlayImageUrl(overlay.filename)"
                    :alt="overlay.name"
                    class="w-full h-full object-cover"
                    @error="(event) => handleImageError(event, overlay.id)"
                    @load="(event) => handleImageLoad(event, overlay.id)"
                  />
                  <div 
                    class="text-2xl font-bold text-surface-500"
                    :class="{ 'hidden': !imageErrors[overlay.id] }"
                  >
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

                <!-- AI : Zoom button -->
                <button 
                  class="bg-surface-50 border border-surface-200 rounded-md w-8 h-8 flex items-center justify-center text-surface-500 hover:bg-surface-100 hover:text-surface-600 transition-all flex-shrink-0" 
                  @click.stop="handleOverlayClick(overlay)"
                >
                  <i class="pi pi-search"></i>
                  <span class="sr-only">Zoom to {{ overlay.name }}</span>
                </button>
              </div>
            </div>
          </AccordionContent>
        </AccordionPanel>
      </Accordion>
      
      <div class="flex flex-col gap-3" v-else-if="projects.length > 0 && filteredProjects.length === 0">
        <div class="flex flex-col items-center justify-center p-12 text-center text-surface-600">
          <i class="pi pi-filter text-5xl text-surface-400 mb-4"></i>
          <p class="text-base mb-2">No projects match the current filter.</p>
          <p class="text-sm">Try changing your filter settings.</p>
        </div>
      </div>
      
      <div v-else-if="!isLoading" class="flex flex-col items-center justify-center p-12 text-center text-surface-600">
        <i class="pi pi-folder text-5xl text-surface-400 mb-4"></i>
        <p class="text-base mb-2">No projects found.</p>
        <p class="text-sm">Create your first construction project!</p>
      </div>
      
      <div v-if="isLoading" class="flex flex-col items-center justify-center p-12 text-center text-surface-600">
        <i class="pi pi-spin pi-spinner text-2xl mb-4"></i>
        <p>Loading projects...</p>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { trpc } from '../../client'
import { buildImageUrl, formatRelativeTime } from '../../utils'
import { navigateToOverlay } from '../../composables/overlay/useOverlayActions'
import Tag from 'primevue/tag'
import Accordion from 'primevue/accordion'
import AccordionPanel from 'primevue/accordionpanel'
import AccordionHeader from 'primevue/accordionheader'
import AccordionContent from 'primevue/accordioncontent'
import Card from 'primevue/card'
import Checkbox from 'primevue/checkbox'

// AI : Reactive state
const projects = ref<any[]>([])
const isLoading = ref(false)
const showApprovedRejected = ref(false)
const imageErrors = ref<Record<string, boolean>>({})

// AI : Computed filtered projects
const filteredProjects = computed(() => {
  if (showApprovedRejected.value) {
    return projects.value
  }
  return projects.value.filter(project => project.status === 'pending')
})

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

// AI : Handle project click - navigate to project or open it
function handleProjectClick(project: any) {
  // AI : For now, just log the project - can be extended later
  console.log('Project clicked:', project.name, project.id)
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
function handleImageError(event: Event, overlayId: string) {
  imageErrors.value[overlayId] = true
  const target = event.target as HTMLImageElement
  target.style.display = 'none'
}

// AI : Handle image loading success
function handleImageLoad(event: Event, overlayId: string) {
  imageErrors.value[overlayId] = false
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

// AI : Handle overlay click - navigate to overlay
async function handleOverlayClick(overlay: any) {
  try {
    await navigateToOverlay(overlay.id)
    console.log('Successfully navigated to overlay:', overlay.id)
  } catch (error) {
    console.error('Failed to navigate to overlay:', error)
  }
}

// AI : Fetch all projects from API
async function fetchAllProjects() {
  try {
    isLoading.value = true
    const result = await trpc.project.getAllProjects.query({
      limit: 50
    })
    projects.value = result
  } catch (error) {
    console.error('Error fetching projects:', error)
  } finally {
    isLoading.value = false
  }
}

// AI : Load initial data
onMounted(() => {
  fetchAllProjects()
})
</script>

<style scoped>
.my-contributions-panel {
  height: 100%;
  display: flex;
  flex-direction: column;
}

.panel-content {
  flex: 1;
  padding: 1rem;
  /* AI : No overflow on individual panels - parent handles scrolling */
  overflow: visible;
}

.panel-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 1rem;
}

.filter-controls {
  display: flex;
  align-items: center;
  gap: 1rem;
}

.field-checkbox {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.field-checkbox label {
  font-size: 0.875rem;
  color: var(--p-surface-600);
  cursor: pointer;
}

.panel-title {
  margin: 0;
  font-size: 1.125rem;
  font-weight: 600;
  color: var(--p-surface-700);
}

.project-name {
  font-weight: 600;
  color: var(--p-surface-900);
  font-size: 0.875rem;
  margin-bottom: 0.25rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.project-location {
  display: flex;
  align-items: center;
  gap: 0.375rem;
  color: var(--p-blue-600);
  font-size: 0.75rem;
  margin-bottom: 0.25rem;
  font-weight: 500;
}

.project-location i {
  color: var(--p-blue-500);
}

.project-status-tag {
  font-size: 0.75rem;
  text-transform: lowercase;
}

/* AI : Accordion styling to match moderation panel */
:deep(.p-accordion-panel .p-accordion-header) {
  transition: background-color 0.15s ease;
}

:deep(.p-accordion-panel .p-accordion-header:hover) {
  background-color: var(--p-surface-50) !important;
}

:deep(.p-accordion-panel .p-accordion-header .p-accordion-header-content) {
  transition: all 0.15s ease;
}

:deep(.p-accordion-panel .p-accordion-header:hover .p-accordion-header-content) {
  color: var(--p-surface-700) !important;
}

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

.project-details-card {
  margin-bottom: 1rem;
  box-shadow: none;
  border: none;
  background-color: #f8f9fa;
}

.project-content-wrapper {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 1rem;
}

.project-info-section {
  flex: 1;
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

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

/* AI : Accordion header hover effects */
:deep(.p-accordion-panel .p-accordion-header:hover) {
  background-color: var(--p-surface-50) !important;
}

:deep(.p-accordion-panel .p-accordion-header:hover .p-accordion-toggle-icon) {
  color: var(--p-primary-color) !important;
}

/* AI : Mobile responsive adjustments */
@media (max-width: 768px) {
  .panel-content {
    padding: 0.75rem;
  }
  
  .panel-header {
    flex-direction: column;
    align-items: flex-start;
    gap: 1rem;
  }
}
</style>