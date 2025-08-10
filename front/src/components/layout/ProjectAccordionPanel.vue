<template>
  <div :class="panelClass">
    <div class="panel-content">
      <div class="panel-header">
        <h3 class="panel-title">{{ title }}</h3>
        <div v-if="$slots['header-actions']" class="header-actions">
          <slot name="header-actions"></slot>
        </div>
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
            <div class="accordion-header-content">
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
                        <span>&nbsp;{{ formatRelativeTime(project.updatedAt) }}</span>
                      </div>
                      <div
                        class="metadata-item"
                        v-if="getProjectLocation(project)"
                      >
                        <i class="pi pi-map-marker"></i>
                        <span>&nbsp;{{ getProjectLocation(project) }}</span>
                      </div>
                      <div class="metadata-item">
                        <i class="pi pi-images"></i>
                        <span>&nbsp;{{ project.overlayCount || (project.overlays ? project.overlays.length : 0) }} overlays</span>
                      </div>
                    </div>
                  </div>

                  <!-- AI : Project actions slot for moderation panel -->
                  <div v-if="$slots['project-actions']" class="project-actions">
                    <slot name="project-actions" :project="project"></slot>
                  </div>
                </div>
              </template>
            </Card>

            <!-- AI : Project overlays -->
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

                <!-- AI : Overlay action buttons slot or default zoom button -->
                <div v-if="$slots['overlay-actions']" class="flex flex-col gap-2">
                  <slot name="overlay-actions" :overlay="overlay"></slot>
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
            </div>
          </AccordionContent>
        </AccordionPanel>
      </Accordion>
      
      <!-- AI : Empty state -->
      <div v-else-if="!isLoading" class="flex flex-col items-center justify-center p-12 text-center text-surface-600">
        <i class="pi pi-folder text-5xl text-surface-400 mb-4"></i>
        <p class="text-base mb-2">{{ emptyMessage }}</p>
        <p class="text-sm">{{ emptySubMessage }}</p>
      </div>
      
      <!-- AI : Loading state -->
      <div v-if="isLoading" class="flex flex-col items-center justify-center p-12 text-center text-surface-600">
        <i class="pi pi-spin pi-spinner text-2xl mb-4"></i>
        <p>Loading projects...</p>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { buildImageUrl, formatRelativeTime } from '../../utils'
import { navigateToOverlay } from '../../composables/overlay/useOverlayActions'
import Tag from 'primevue/tag'
import Accordion from 'primevue/accordion'
import AccordionPanel from 'primevue/accordionpanel'
import AccordionHeader from 'primevue/accordionheader'
import AccordionContent from 'primevue/accordioncontent'
import Card from 'primevue/card'

// AI : Props interface
interface Props {
  projects: any[]
  isLoading: boolean
  title: string
  panelClass: string
  emptyMessage?: string
  emptySubMessage?: string
}

const props = withDefaults(defineProps<Props>(), {
  emptyMessage: 'No projects found.',
  emptySubMessage: 'Create your first construction project!'
})

// AI : Reactive state for image errors
const imageErrors = ref<Record<string, boolean>>({})

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

// AI : Get project location display
function getProjectLocation(project: any): string {
  if (project.cityName && project.countryName) {
    return `${project.cityName}, ${project.countryName}`
  } else if (project.city?.name && project.city?.countryName) {
    return `${project.city.name}, ${project.city.countryName}`
  } else if (project.cityName) {
    return project.cityName
  } else if (project.city?.name) {
    return project.city.name
  }
  return ''
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
.project-status-tag {
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
  z-index: 10;
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
</style>