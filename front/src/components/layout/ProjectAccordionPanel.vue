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

      <div
        v-if="projects.length > 0"
        class="grouped-accordion-container"
      >
        <template
          v-for="countryGroup in groupedByCountry"
          :key="countryGroup.countryCode"
        >
          <div class="country-group">
            <div
              class="country-group-header"
              @click="handleToggleCountryExpanded(countryGroup.countryCode)"
            >
              <div class="country-header-content">
                <i
                  :class="['pi', isCountryExpanded(countryGroup.countryCode) ? 'pi-chevron-down' : 'pi-chevron-right']"></i>
                <h3 class="country-group-title">{{ countryGroup.countryName }}</h3>
                <span class="country-group-count">{{ countryGroup.totalProjects }}</span>
              </div>
            </div>

            <div
              v-if="isCountryExpanded(countryGroup.countryCode)"
              class="country-content"
            >
              <template
                v-for="cityGroup in countryGroup.cities"
                :key="cityGroup.key"
              >
                <div
                  class="city-group-header"
                  @click="toggleCityExpanded(cityGroup.key)"
                >
                  <div class="city-header-content">
                    <i :class="['pi', isCityExpanded(cityGroup.key) ? 'pi-chevron-down' : 'pi-chevron-right']"></i>
                    <h4 class="city-group-title">{{ cityGroup.cityName }}</h4>
                  </div>
                  <span class="city-group-count">{{ cityGroup.projects.length }}</span>
                </div>

                <Accordion
                  v-if="isCityExpanded(cityGroup.key)"
                  :multiple="true"
                  v-model:value="activeAccordionPanels"
                  class="city-accordion"
                >
                  <AccordionPanel
                    v-for="project in cityGroup.projects"
                    :key="project.id"
                    :value="project.id"
                  >
                    <AccordionHeader>
                      <div class="accordion-header-content">
                        <span class="project-name">{{ project.name }}</span>
                        <Tag
                          :value="$t(`status.${project.status}`)"
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
                        @click="handleCardClick(project)"
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
                                  <span>{{ $t('project.updatedAgo', { time: formatRelativeTime(project.updatedAt) })
                                  }}</span>
                                </div>
                                <div
                                  class="metadata-item"
                                  v-if="getProjectLocation(project)"
                                >
                                  <i class="pi pi-map-marker"></i>
                                  <span>{{ getProjectLocation(project) }}</span>
                                </div>
                                <div
                                  v-if="!project.isDevelopment"
                                  class="metadata-item"
                                >
                                  <i class="pi pi-images"></i>
                                  <span>{{ project.overlayCount || (project.overlays ? project.overlays.length : 0) }}
                                    {{ $t('overlay.overlayImages') }}</span>
                                </div>
                                <div
                                  class="metadata-item"
                                  v-if="project.startDate || project.endDate || project.proposalDate"
                                >
                                  <i class="pi pi-calendar"></i>
                                  <span>{{ formatProjectDateRange(project.startDate, project.endDate, project.proposalDate) }}</span>
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

                            <!-- AI : Actions column - either slot actions or zoom button -->
                            <div class="project-actions-column">
                              <!-- AI : Project actions slot for moderation panel -->
                              <slot
                                v-if="$slots['project-actions']"
                                name="project-actions"
                                :project="project"
                              ></slot>

                              <!-- AI : Zoom button for development projects (always shown for dev projects) -->
                              <button
                                v-if="project.isDevelopment"
                                class="action-btn"
                                @click.stop="handleDevelopmentProjectClick(project)"
                                v-tooltip.top="$t('overlay.zoomTo') + ' ' + project.name"
                              >
                                <i class="pi pi-search"></i>
                              </button>
                            </div>
                          </div>

                          <ChangeRequestSection
                            v-if="getProjectChangeRequestsForProject(project.id).length > 0"
                            :changes="getProjectChangeRequestsForProject(project.id)"
                            :all-change-requests="changeRequests"
                            :projects="projects"
                            :is-my-contributions="isMyContributionsPanel"
                            :on-navigate-to-overlay="navigateToOverlayById"
                            container-class="project-change-requests"
                          >
                            <template #change-actions="{ change }">
                              <slot
                                name="change-actions"
                                :change="change"
                              ></slot>
                            </template>
                          </ChangeRequestSection>
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
                          :data-overlay-id="overlay.id"
                          class="overlay-card-wrapper"
                          :class="{ 'has-changes': getOverlayChangeRequestsForOverlay(overlay.id).length > 0 }"
                        >
                          <div
                            class="overlay-card"
                            @click="handleOverlayCardClick(overlay, true)"
                          >
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
                                <p class="overlay-name">{{ overlay.name || $t('overlay.untitled') }}</p>
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
                              <div class="flex items-center gap-2 flex-wrap">
                                <Tag
                                  :value="$t(`status.${overlay.status}`)"
                                  :severity="getStatusSeverity(overlay.status)"
                                  class="overlay-status-tag"
                                  rounded
                                />
                                <button
                                  v-if="overlay.replacesOverlayId && overlay.status === 'pending'"
                                  class="replacement-badge"
                                  @click.stop="navigateToOverlayById(overlay.replacesOverlayId)"
                                  v-tooltip.top="$t('overlay.viewOriginalOverlay')"
                                >
                                  <i class="pi pi-arrow-up-left"></i>
                                  {{ $t('overlay.replaces') }}
                                </button>
                              </div>
                            </div>

                            <!-- AI : Overlay action buttons slot -->
                            <div
                              v-if="$slots['overlay-actions']"
                              class="flex flex-col gap-2"
                              @click.stop
                            >
                              <slot
                                name="overlay-actions"
                                :overlay="overlay"
                                :project="project"
                              ></slot>
                            </div>
                          </div>

                          <ChangeRequestSection
                            v-if="getOverlayChangeRequestsForOverlay(overlay.id).length > 0"
                            :changes="getOverlayChangeRequestsForOverlay(overlay.id)"
                            :all-change-requests="changeRequests"
                            :projects="projects"
                            :is-my-contributions="isMyContributionsPanel"
                            :is-overlay-changes="true"
                            :entity-name="overlay.name || $t('overlay.untitled')"
                            :on-navigate-to-overlay="navigateToOverlayById"
                            container-class="overlay-change-requests"
                          >
                            <template #change-actions="{ change }">
                              <slot
                                name="change-actions"
                                :change="change"
                              ></slot>
                            </template>
                          </ChangeRequestSection>
                        </div>
                      </div>
                    </AccordionContent>
                  </AccordionPanel>
                </Accordion>
              </template>
            </div>
          </div>
        </template>
      </div>

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
        <p>{{ $t('overlay.loadingProjects') }}</p>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue'
import { useI18n } from 'vue-i18n'
import { buildThumbnailUrl } from '@utils/imageUrl'
import { formatRelativeTime, formatDate } from '@utils/dateFormat'
import { formatSourceUrl } from '@utils/urlFormat'
import { navigateToDevelopmentProject } from '@composables/navigation/useOverlayNavigation'
import { useOverlayClickHandler } from '@composables/overlay/useOverlayClickHandler'
import { useToast } from '@composables/ui/useToast'
import { useOverlayStore } from '@stores/pinia/overlayStore'
import { useAccordionState } from '@composables/layout/useAccordionState'
import type { ProjectForModeration, OverlayForModeration } from '@types'
import type { PendingChangeRequest } from '../../types/api'
import ChangeRequestSection from './ChangeRequestSection.vue'

// AI : Props interface
interface Props {
  projects: ProjectForModeration[]
  isLoading: boolean
  title: string
  panelClass: string
  emptyMessage?: string
  emptySubMessage?: string
  changeRequests?: PendingChangeRequest[]
  onOverlayClick?: (overlay: OverlayForModeration, shouldFitBounds: boolean) => Promise<void>
}

const props = withDefaults(defineProps<Props>(), {
  emptyMessage: '',
  emptySubMessage: '',
  changeRequests: () => []
})

// AI : Use i18n for translations
const { t } = useI18n()
const toast = useToast()
const overlayStore = useOverlayStore()

// AI : Use shared accordion state (persists across My Contributions and Moderation panels)
const {
  activeAccordionPanels,
  expandedCountries,
  expandedCities,
  toggleCountryExpanded,
  isCountryExpanded,
  toggleCityExpanded,
  isCityExpanded,
  expandAccordionForOverlay
} = useAccordionState()

// AI : Reactive state for image errors
const imageErrors = ref<Record<string, boolean>>({})

// AI : Use overlay click handler composable for shared navigation logic
const { handleOverlayClickNavigation } = useOverlayClickHandler()

// AI : Wrapper to navigate to overlay by ID
async function navigateToOverlayById(overlayId: string) {
  for (const project of props.projects) {
    if (project.overlays) {
      const overlay = project.overlays.find(o => o.id === overlayId)
      if (overlay) {
        await handleOverlayClickNavigation(overlay, true)
        return
      }
    }
  }
}

// AI : Helper functions to filter change requests
function getProjectChangeRequestsForProject(projectId: string): PendingChangeRequest[] {
  const project = props.projects.find(p => p.id === projectId)
  if (!project || project.status === 'pending') {
    return []
  }
  return props.changeRequests.filter(
    request => request.entityType === 'project' && request.entityId === projectId
  )
}

function getOverlayChangeRequestsForOverlay(overlayId: string): PendingChangeRequest[] {
  let overlay: OverlayForModeration | null = null
  for (const project of props.projects) {
    if (project.overlays) {
      overlay = project.overlays.find((o: OverlayForModeration) => o.id === overlayId) ?? null
      if (overlay) break
    }
  }
  if (!overlay || overlay.status === 'pending') {
    return []
  }
  return props.changeRequests.filter(
    request => request.entityType === 'overlay' && request.entityId === overlayId
  )
}

const expandedPanels = computed(() => new Set(activeAccordionPanels.value))

const isMyContributionsPanel = computed(() => props.panelClass === 'my-contributions-panel')

interface CityGroup {
  key: string;
  cityName: string;
  projects: ProjectForModeration[];
}

interface CountryGroup {
  countryCode: string;
  countryName: string;
  totalProjects: number;
  cities: CityGroup[];
}

const groupedByCountry = computed(() => {
  const countryMap = new Map<string, CountryGroup>();

  for (const project of props.projects) {
    const countryName = project.countryName ?? 'Unknown Country';
    const cityName = project.cityName ?? 'Unknown City';
    const countryCode = project.countryCode ?? 'unknown';

    if (!countryMap.has(countryCode)) {
      countryMap.set(countryCode, {
        countryCode,
        countryName,
        totalProjects: 0,
        cities: []
      });
    }

    const country = countryMap.get(countryCode)!;
    country.totalProjects++;

    let cityGroup = country.cities.find(c => c.cityName === cityName);
    if (!cityGroup) {
      cityGroup = {
        key: `${countryCode}-${cityName}`,
        cityName,
        projects: []
      };
      country.cities.push(cityGroup);
    }

    cityGroup.projects.push(project);
  }

  const sorted = Array.from(countryMap.values()).sort((a, b) =>
    a.countryName.localeCompare(b.countryName)
  );

  sorted.forEach(country => {
    country.cities.sort((a, b) => a.cityName.localeCompare(b.cityName));
  });

  return sorted;
})

// AI : Wrapper to pass country group data to the shared state function
function handleToggleCountryExpanded(countryCode: string) {
  const country = groupedByCountry.value.find(c => c.countryCode === countryCode)
  toggleCountryExpanded(countryCode, country)
}

// AI : Watch for overlay selection and mode changes to auto-expand accordions
watch(
  () => [overlayStore.idSelectedOverlay, overlayStore.mode, props.projects] as const,
  async ([selectedOverlayId, _mode, projects]) => {
    if (selectedOverlayId && projects.length > 0) {
      // AI : Wait for Vue to finish rendering the updated projects
      await nextTick()

      // AI : Try to expand the accordion hierarchy
      const expanded = expandAccordionForOverlay(selectedOverlayId, projects)

      if (expanded) {
        // AI : Wait for DOM to update with expanded accordion
        await nextTick()

        // AI : Wait for accordion animation to complete, then scroll
        await waitForAccordionAnimation(selectedOverlayId)
      }
    }
  },
  { deep: true }
)

/**
 * AI : Wait for accordion expansion animation to complete
 * AI : Uses requestAnimationFrame for smooth coordination with browser rendering
 */
async function waitForAccordionAnimation(overlayId: string): Promise<void> {
  // AI : Find the overlay element to check if it exists and is visible
  const overlayElement = document.querySelector(`[data-overlay-id="${overlayId}"]`)

  if (!overlayElement) {
    // AI : Element not found, wait a frame and try again (max 3 attempts)
    for (let i = 0; i < 3; i++) {
      await new Promise(resolve => requestAnimationFrame(resolve))
      const element = document.querySelector(`[data-overlay-id="${overlayId}"]`)
      if (element) {
        await scrollToOverlayWhenReady(element)
        return
      }
    }
    return
  }

  await scrollToOverlayWhenReady(overlayElement)
}

/**
 * AI : Scroll to overlay element once it's fully rendered and positioned
 */
async function scrollToOverlayWhenReady(element: Element): Promise<void> {
  // AI : Wait for the element to be fully rendered and positioned
  // AI : Use requestAnimationFrame to sync with browser paint cycle
  await new Promise(resolve => requestAnimationFrame(resolve))
  await new Promise(resolve => requestAnimationFrame(resolve))

  // AI : Scroll with smooth behavior
  element.scrollIntoView({
    behavior: 'smooth',
    block: 'center',
    inline: 'nearest'
  })
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

// AI : Get badge severity based on status
function getStatusSeverity(status: string): string {
  switch (status) {
    case 'approved':
      return 'success'
    case 'rejected':
      return 'danger'
    case 'pending':
      return 'warn'
    case 'replaced':
      return 'secondary'
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

// AI : Format project dates as dd/mm/yyyy
function formatProjectDate(date: Date | null): string {
  if (!date) return ''
  return formatDate(date)
}

// AI : Format project date range including proposal date support with i18n
function formatProjectDateRange(startDate: Date | null, endDate: Date | null, proposalDate?: Date | null): string {
  // AI : If it's a proposed project, show "Proposed on {date}"
  if (proposalDate) {
    return `${t('project.proposed')} ${formatProjectDate(proposalDate)}`
  }

  const start = startDate ? formatProjectDate(startDate) : null
  const end = endDate ? formatProjectDate(endDate) : null

  if (start && end) {
    return `${start} - ${end}`
  } else if (start) {
    return `${t('project.starts')} ${start}`
  } else if (end) {
    return `${t('project.ends')} ${end}`
  }
  return ''
}

// AI : Check if overlays should be shown (only for expanded panels)
function shouldShowOverlays(project: ProjectForModeration): boolean {
  return expandedPanels.value.has(project.id)
}

// AI : Handle card click - navigate for development projects
function handleCardClick(project: ProjectForModeration) {
  // AI : For development projects, clicking the card also navigates (in addition to the button)
  // AI : This provides a larger click area for better UX
  if (project.isDevelopment) {
    handleDevelopmentProjectClick(project)
  }
}

// AI : Handle development project click - zoom to marker location and open popup
async function handleDevelopmentProjectClick(project: ProjectForModeration) {
  try {
    if (!project.lat || !project.lng) {
      toast.add({
        severity: 'warn',
        summary: t('project.noLocation'),
        detail: t('project.noLocation'),
        life: 3000
      })
      return
    }

    if (!project.cityId || !project.cityName) {
      toast.add({
        severity: 'warn',
        summary: t('project.missingCityInfo'),
        detail: t('project.cannotNavigateWithoutCity'),
        life: 3000
      })
      return
    }

    // AI : Ensure edit mode is enabled before navigating (required to see markers)
    const overlayStore = useOverlayStore()
    if (overlayStore.mode !== 'edit') {
      overlayStore.setMode('edit')
    }

    await navigateToDevelopmentProject(
      project.lat,
      project.lng,
      project.cityId,
      project.cityName,
      project.countryCode ?? undefined,
      project.id
    )
  } catch (error) {
    console.error('Failed to navigate to development project:', error)
    toast.add({
      severity: 'error',
      summary: t('overlay.navigationFailed'),
      detail: error instanceof Error ? error.message : t('overlay.failedToNavigate'),
      life: 3000
    })
  }
}

// AI : Handle overlay card click - use custom handler if provided (for moderation), otherwise use default
async function handleOverlayCardClick(overlay: OverlayForModeration, shouldFitBounds: boolean) {
  if (props.onOverlayClick) {
    // AI : Use custom handler (for moderation panel to mark as viewed)
    await props.onOverlayClick(overlay, shouldFitBounds)
  } else {
    // AI : Use default handler
    await handleOverlayClickNavigation(overlay, shouldFitBounds)
  }
}

</script>

<style scoped>
/* AI : Grouped accordion container */
.grouped-accordion-container {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.country-group {
  background: var(--p-surface-0);
  border: 1px solid var(--p-surface-200);
  border-radius: 8px;
  overflow: hidden;
}

.country-group-header {
  padding: 0.875rem 1rem;
  background: var(--p-primary-50);
  border-bottom: 2px solid var(--p-primary-200);
  cursor: pointer;
  transition: background 0.15s ease;
  user-select: none;
}

.country-group-header:hover {
  background: var(--p-primary-100);
}

.country-header-content {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.country-header-content i {
  color: var(--p-primary-600);
  font-size: 0.75rem;
  transition: transform 0.2s ease;
}

.country-group-title {
  margin: 0;
  font-size: 1rem;
  font-weight: 700;
  color: var(--p-surface-900);
  flex: 1;
}

.country-group-count {
  font-size: 0.8125rem;
  font-weight: 700;
  color: var(--p-primary-700);
  background: var(--p-primary-200);
  padding: 0.25rem 0.625rem;
  border-radius: 12px;
  min-width: 28px;
  text-align: center;
}

.country-content {
  padding: 0.5rem;
}

.city-group-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.625rem 0.875rem;
  margin-top: 0.75rem;
  margin-bottom: 0.5rem;
  background: var(--p-surface-100);
  border-left: 3px solid var(--p-surface-400);
  border-radius: 4px;
  cursor: pointer;
  transition: background 0.15s ease;
  user-select: none;
}

.city-group-header:hover {
  background: var(--p-surface-200);
}

.city-group-header:first-child {
  margin-top: 0.25rem;
}

.city-header-content {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.city-header-content i {
  color: var(--p-surface-500);
  font-size: 0.625rem;
  transition: transform 0.2s ease;
}

.city-group-title {
  margin: 0;
  font-size: 0.8125rem;
  font-weight: 600;
  color: var(--p-surface-700);
}

.city-group-count {
  font-size: 0.6875rem;
  font-weight: 600;
  color: var(--p-surface-600);
  background: var(--p-surface-200);
  padding: 0.125rem 0.5rem;
  border-radius: 12px;
  min-width: 20px;
  text-align: center;
}

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
  padding: 0rem 0 1rem 1rem;
  overflow: visible;
}

/* Sticky header for panel title  */
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
  z-index: 10; /* z-index to prevent accordion headers from overlapping */
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

/* AI : Project content wrapper with vertical button stack on the right */
.project-content-wrapper {
  display: flex;
  flex-direction: row;
  align-items: flex-start;
  gap: 0.75rem;
}

/* AI : Actions column - vertical stack of buttons on the right */
.project-actions-column {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  flex-shrink: 0;
  align-self: flex-start;
}

/* AI : Override any flex row styles from child components */
.project-actions-column>* {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

/* AI : Action button styling - matches moderation panel buttons */
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

/* AI : Replacement badge styling */
.replacement-badge {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  padding: 0.25rem 0.5rem;
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--p-purple-700);
  background-color: var(--p-purple-50);
  border: 1px solid var(--p-purple-200);
  border-radius: 0.375rem;
  cursor: pointer;
  transition: all 0.2s;
  white-space: nowrap;
}

.replacement-badge:hover {
  background-color: var(--p-purple-100);
  border-color: var(--p-purple-300);
  color: var(--p-purple-800);
}

.replacement-badge i {
  font-size: 0.625rem;
}

</style>
