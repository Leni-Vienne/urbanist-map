<template>
  <!-- AI : No city selected state -->
  <PanelEmptyState
    v-if="!mapStore.selectedCity"
    icon="map-marker"
    :message="$t('currentCity.noCity')"
    :sub-message="$t('currentCity.selectCityPrompt')"
  />

  <!-- AI : Use ProjectAccordionPanel to display current city's projects -->
  <ProjectAccordionPanel
    v-else
    :projects="projectsWithOverlays"
    :is-loading="false"
    :on-overlay-click="handleOverlayClick"
    :hide-status-badges="true"
    :disable-auto-mode-switch="true"
    :disable-grouping="true"
    :show-edit-buttons="false"
    :should-switch-to-edit-mode="true"
    title=""
    panel-class="current-city-panel"
    :empty-message="$t('currentCity.noProjects')"
    :empty-sub-message="$t('currentCity.noProjectsDetail')"
  >
    <!-- AI : Custom header showing Country > City -->
    <template #header-actions>
      <div class="header-actions-container">
        <!-- AI : Always render wrapper to maintain flex layout, conditionally render content -->
        <span class="city-header">
          <template v-if="cityHeader">
            <span
              class="country-link"
              @click="handleCountryClick"
              :title="$t('currentCity.clickToZoomCountry')"
            >
              {{ cityHeader.countryName }}
            </span>
            <i class="pi pi-angle-right separator"></i>
            <span class="city-name">{{ cityHeader.cityName }}</span>
          </template>
        </span>
        <!-- AI : New Project button - aligned to the right -->
        <Button
          @click="handleAddOverlayClick"
          severity="primary"
          size="small"
          icon="pi pi-plus"
          :label="$t('common.add')"
          class="add-project-button"
          v-tooltip.bottom="$t('dialog.createNewProject')"
        />
      </div>
    </template>

    <template #empty-state>
      <i class="pi pi-folder text-5xl text-surface-400 mb-4"></i>
      <p class="text-base mb-2">{{ $t('currentCity.noProjects') }}</p>
      <p class="text-sm">{{ $t('currentCity.noProjectsDetail') }}</p>
    </template>
  </ProjectAccordionPanel>
</template>

<script setup lang="ts">
import { computed, watch, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useMapStore } from '@/stores/pinia/mapStore'
import { useOverlayStore } from '@/stores/pinia/overlayStore'
import { useProjectStore } from '@/stores/pinia/projectStore'
import { useOverlayClickHandler } from '@/composables/overlay/useOverlayClickHandler'
import { isValidCountryCode } from '@/composables/map/useCountryMarkers'
import { flyToCountry } from '@/composables/map/useMapNavigation'
import { useAccordionState } from '@/composables/layout/useAccordionState'
import { useAddOverlay } from '@/composables/overlay/useAddOverlay'
import { createProjectFromOverlayData, createOverlayForModeration } from '@/utils/projectFactories'
import ProjectAccordionPanel from './ProjectAccordionPanel.vue'
import PanelEmptyState from '@/components/common/PanelEmptyState.vue'
import type { ProjectForModeration, OverlayForModeration } from '@/types/index'
import type { ApprovalStatus } from '@shared/types';

// AI : Stores
const { t } = useI18n()
const mapStore = useMapStore()
const overlayStore = useOverlayStore()
const projectStore = useProjectStore()

// AI : Get accordion state to manually expand when needed
const { expandAccordionForOverlay } = useAccordionState()

// AI : Use shared composable for add overlay button
const { handleAddOverlayClick } = useAddOverlay()

// AI : Compute header showing "Country > City"
const cityHeader = computed(() => {
    if (!mapStore.selectedCity) return null

    const { countryCode, name: cityName } = mapStore.selectedCity
    if (!countryCode) return null

    // AI : Find country name from countries list
    const country = projectStore.countries.find(c => c.code === countryCode)
    if (!country) return null

    return {
        countryName: country.name,
        countryCode,
        cityName,
        lat: country.lat,
        lng: country.lng
    }
})

// AI : Handle country click - zoom to country view WITHOUT clearing selected city
// AI : This differs from country marker clicks which use prepareCountryContext and clear the city
// AI : Here we want to maintain panel context while allowing users to zoom out
async function handleCountryClick() {
    const header = cityHeader.value
    if (!header) return

    if (!isValidCountryCode(header.countryCode)) return

    // AI : Fly to the country using its centroid
    flyToCountry(header.countryCode, header.lat, header.lng)

    // AI : Set the selected country code (for tile layer management)
    mapStore.selectedCountryCode = header.countryCode

    // AI : NOTE: We intentionally DO NOT clear the selected city or manually load/add markers
    // AI : The city markers are already present from when the city was selected, and the
    // AI : reactive state management handles everything else. This keeps the Current City
    // AI : panel header visible and maintains user context while zooming out to country view
}


// AI : Custom overlay click handler that doesn't switch to edit mode (like Latest Contributions)
const { handleOverlayClickNavigation } = useOverlayClickHandler()

async function handleOverlayClick(overlay: OverlayForModeration): Promise<void> {
    // AI : Pass false for shouldToggleEditMode to prevent unwanted mode switching
    // AI : This matches the behavior of Latest Contributions panel
    await handleOverlayClickNavigation(overlay, false)
}

// AI : Build projects with overlays from mode-aware cache
const projectsWithOverlays = computed(() => {
    if (!mapStore.selectedCity) {
        return []
    }

    // AI : Get overlays from mode-aware cache (same pattern as standalone projects)
    // AI : This ensures view mode only shows approved overlays, edit mode shows approved + user's own
    const overlaysForMode = mapStore.getCityOverlaysAndProjectsCache(
        mapStore.selectedCity.id,
        overlayStore.mode
    ) ?? []

    // AI : Group overlays by project
    const projectsMap = new Map<string, ProjectForModeration>()

    for (const overlayData of overlaysForMode) {
        const projectId = overlayData.projectId
        if (!projectId) continue

        if (!projectsMap.has(projectId)) {
            // AI : Use factory to create project from overlay data
            projectsMap.set(projectId, createProjectFromOverlayData(
                overlayData,
                mapStore.selectedCity,
                projectStore.countries
            ))
        }

        const project = projectsMap.get(projectId);
        if (!project) continue;

        // AI : Use factory to create overlay
        const overlay = createOverlayForModeration(overlayData, mapStore.selectedCity)

        project.overlays = project.overlays || []
        project.overlays.push(overlay)
    }

    // AI : Add standalone projects from cache (projects without overlays)
    const standaloneProjects = mapStore.cityStandaloneProjectsCache
        .get(mapStore.selectedCity.id)?.get(overlayStore.mode) ?? []

    for (const standaloneSummary of standaloneProjects) {
        // AI : Only add if not already in map (from overlays) and if it truly has no overlays
        if (!projectsMap.has(standaloneSummary.id) && standaloneSummary.overlayCount === 0) {
            projectsMap.set(standaloneSummary.id, {
                id: standaloneSummary.id,
                name: standaloneSummary.name,
                description: standaloneSummary.description,
                status: standaloneSummary.status,
                ownerId: standaloneSummary.ownerId,
                cityId: standaloneSummary.cityId,
                lat: standaloneSummary.lat,
                lng: standaloneSummary.lng,
                proposalDate: standaloneSummary.proposalDate,
                startDate: standaloneSummary.startDate,
                endDate: standaloneSummary.endDate,
                sourceUrl: standaloneSummary.sourceUrl,
                createdAt: standaloneSummary.createdAt,
                updatedAt: standaloneSummary.updatedAt,
                version: 0, // Not in summary
                countryCode: standaloneSummary.city.countryCode ?? null,
                countryName: projectStore.countries.find(c => c.code === standaloneSummary.city.countryCode)?.name ?? null,
                cityName: standaloneSummary.city.name,
                overlays: []
            })
        }
    }

    // AI : Convert to array and sort by name
    return [...projectsMap.values()].toSorted((a, b) => a.name.localeCompare(b.name))
})

// AI : When component mounts, check if an overlay is already selected
// AI : This handles the case where the tab switches to currentCity after overlay is selected
onMounted(async () => {
    const selectedOverlayId = overlayStore.idSelectedOverlay
    const projects = projectsWithOverlays.value
    if (selectedOverlayId && projects.length > 0) {
        expandAccordionForOverlay(selectedOverlayId, projects)
    }
})

// AI : Watch for overlay selection to manually trigger accordion expansion
// AI : This ensures the accordion expands even if the default watcher in ProjectAccordionPanel
// AI : fires before the projects are fully populated
// AI : We track projects by length rather than deep watching to avoid fragile reactive dependencies
watch(
    () => ({
        overlayId: overlayStore.idSelectedOverlay,
        projectCount: projectsWithOverlays.value.length,
        // AI : Include project IDs to detect when projects actually change (not just re-render)
        projectIds: projectsWithOverlays.value.map(p => p.id).join(',')
    }),
    async ({ overlayId, projectCount }) => {
        if (overlayId && projectCount > 0) {
            // AI : Wait for DOM updates before expanding accordion
            expandAccordionForOverlay(overlayId, projectsWithOverlays.value)
        }
    }
)
</script>

<style scoped>
/* AI : Import shared panel CSS */
@import '../../assets/panel-common.css';

/* AI : Empty state when no city is selected */
.empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 3rem 2rem;
    text-align: center;
    color: var(--p-surface-600);
    height: 100%;
}

/* AI : City header breadcrumb styles */
.city-header {
    display: flex;
    align-items: center;
    gap: 0.625rem;
    font-size: 1rem;
    color: var(--p-surface-700);
    font-weight: 600;
    padding: 0.25rem 0;
    min-width: 0;
    /* AI : Allow flex-shrink to work properly */
    flex: 1;
    /* AI : Allow city header to take available space */
}

.country-link {
    color: var(--p-primary-500);
    cursor: pointer;
    transition: all 0.2s ease;
    padding: 0.25rem 0.5rem;
    border-radius: var(--p-border-radius);
    margin: -0.25rem -0.5rem;
    flex-shrink: 0;
    /* AI : Prevent country name from shrinking */
}

.country-link:hover {
    color: var(--p-primary-600);
    background-color: var(--p-primary-50);
}

.separator {
    color: var(--p-surface-500);
    font-size: 0.875rem;
    margin: 0 0.125rem;
    flex-shrink: 0;
    /* AI : Keep separator visible */
}

.city-name {
    color: var(--p-surface-800);
    font-weight: 600;
    overflow: hidden;
    /* AI : Enable text truncation */
    text-overflow: ellipsis;
    /* AI : Show ellipsis for overflow */
    white-space: nowrap;
    /* AI : Prevent wrapping */
    min-width: 0;
    /* AI : Allow shrinking in flex container */
}
</style>
