<template>
  <!-- AI : No location selected state -->
  <PanelEmptyState
    v-if="!mapStore.selectedCity && !mapStore.selectedCountryCode"
    icon="map-marker"
    :message="$t('currentLocation.noLocationSelected')"
    :sub-message="$t('currentLocation.selectLocationPrompt')"
  />

  <!-- AI : Country selected but no city - show city list -->
  <div
    v-else-if="!mapStore.selectedCity && mapStore.selectedCountryCode"
    class="city-list-container"
  >
    <div class="city-list-header">
      <h3 class="header-title">
        {{ selectedCountryName }}
      </h3>
      <p class="header-subtitle">
        {{ $t('currentLocation.selectCityToExplore') }}
      </p>
    </div>

    <!-- AI : No cities state -->
    <PanelEmptyState
      v-if="citiesInCountry.length === 0"
      icon="map"
      :message="$t('currentLocation.noCitiesInCountry')"
    />

    <!-- AI : City list -->
    <div v-else class="city-list">
      <button
        v-for="city in citiesInCountry"
        :key="city.id"
        class="city-item"
        @click="handleCityClick(city)"
      >
        <div class="city-info">
          <span class="city-name">{{ city.name }}</span>
          <span v-if="city.nameLocal && city.nameLocal !== city.name" class="city-name-local">
            {{ city.nameLocal }}
          </span>
        </div>
        <span class="project-count">
          {{ $t('currentLocation.projectsCount', { count: (city as any).projectCount ?? 0 }) }}
        </span>
      </button>
    </div>
  </div>

  <!-- AI : City selected - show project list -->
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
    panel-class="current-location-panel"
    :empty-message="$t('currentLocation.noProjects')"
    :empty-sub-message="$t('currentLocation.noProjectsDetail')"
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
              :title="$t('currentLocation.clickToZoomCountry')"
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
  </ProjectAccordionPanel>
</template>

<script setup lang="ts">
import { computed, watch, onMounted } from 'vue'
import { useMapStore } from '@/stores/pinia/mapStore'
import { useOverlayStore } from '@/stores/pinia/overlayStore'
import { useProjectStore } from '@/stores/pinia/projectStore'
import { useOverlayClickHandler } from '@/composables/overlay/useOverlayClickHandler'
import { isValidCountryCode } from '@/composables/map/useCountryMarkers'
import { flyToCountry } from '@/composables/map/useMapNavigation'
import { useAccordionState } from '@/composables/layout/useAccordionState'
import { useAddOverlay } from '@/composables/overlay/useAddOverlay'
import { loadCityProjects, citiesWithProjects, type CityWithProjects } from '@/composables/map/useCityMarkers'
import { createProjectFromOverlayData, createOverlayForModeration } from '@/utils/projectFactories'
import ProjectAccordionPanel from './ProjectAccordionPanel.vue'
import PanelEmptyState from '@/components/common/PanelEmptyState.vue'
import type { ProjectForModeration, OverlayForModeration } from '@/types/index'

// AI : Stores
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

// AI : Compute selected country name for city list header
const selectedCountryName = computed(() => {
  if (!mapStore.selectedCountryCode) return ''
  const country = projectStore.countries.find(c => c.code === mapStore.selectedCountryCode)
  return country?.name ?? mapStore.selectedCountryCode
})

// AI : Get cities in selected country from global city list (viewport loading loads cities globally)
const citiesInCountry = computed(() => {
  if (!mapStore.selectedCountryCode) return []
  // AI : Use globally loaded cities ref and filter by country code
  return citiesWithProjects.value.filter((city: CityWithProjects) => city.countryCode === mapStore.selectedCountryCode)
})

// AI : Handle city selection from list
async function handleCityClick(city: { id: number; name: string; nameLocal: string | null; countryCode: string; lat: number; lng: number }) {
  // AI : Set the selected city first
  mapStore.setSelectedCity({
    id: city.id,
    name: city.name,
    nameLocal: city.nameLocal,
    countryCode: city.countryCode
  })

  // AI : Fly to the city (same behavior as city marker click)
  const { map } = await import('@/composables/core/useMap')
  const { mobileAwareFlyTo } = await import('@/composables/map/useMapNavigation')
  if (map.value && map.value.getZoom() < 14) {
    mobileAwareFlyTo([city.lat, city.lng], 14, {
      duration: 1.5,
    })
  }

  // AI : Load city projects and navigate to city
  await loadCityProjects(city.id, city.name, city.nameLocal, true, city.countryCode)
}

// AI : Handle country click - zoom to country view AND clear selected city to show city list
async function handleCountryClick() {
  const header = cityHeader.value
  if (!header) return

  if (!isValidCountryCode(header.countryCode)) return

  // AI : Fly to the country using its centroid
  flyToCountry(header.countryCode, header.lat, header.lng)

  // AI : Set the selected country code (for tile layer management)
  mapStore.selectedCountryCode = header.countryCode

  // AI : Clear the selected city to show the city list panel
  mapStore.clearSelectedCity()
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

/* AI : City list view styles */
.city-list-container {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.city-list-header {
  padding: 1rem;
  border-bottom: 1px solid var(--p-surface-100);
  background: var(--p-surface-0);
}

.header-title {
  margin: 0;
  font-size: 1rem;
  font-weight: 600;
  color: var(--p-surface-800);
}

.header-subtitle {
  margin: 0.25rem 0 0 0;
  font-size: 0.8125rem;
  color: var(--p-surface-500);
}

.city-list {
  flex: 1;
  overflow-y: auto;
  padding: 0.5rem;
}

.city-item {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.875rem 1rem;
  border: none;
  background: var(--p-surface-0);
  border-radius: var(--p-border-radius);
  cursor: pointer;
  transition: all 0.15s ease;
  margin-bottom: 0.5rem;
  text-align: left;
}

.city-item:hover {
  background: var(--p-surface-50);
  transform: translateX(2px);
}

.city-item:active {
  background: var(--p-surface-100);
}

.city-info {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  flex: 1;
  min-width: 0;
}

.city-info .city-name {
  font-size: 0.9375rem;
  font-weight: 500;
  color: var(--p-surface-800);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.city-name-local {
  font-size: 0.8125rem;
  color: var(--p-surface-500);
  font-style: italic;
}

.project-count {
  flex-shrink: 0;
  font-size: 0.8125rem;
  color: var(--p-surface-600);
  background: var(--p-surface-100);
  padding: 0.25rem 0.625rem;
  border-radius: 1rem;
  font-weight: 500;
}
</style>
