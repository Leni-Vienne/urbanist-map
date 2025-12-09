<template>
  <!-- AI : No city selected state -->
  <div v-if="!mapStore.selectedCity" class="empty-state">
    <i class="pi pi-map-marker text-5xl text-surface-400 mb-4"></i>
    <p class="text-base mb-2">{{ $t('currentCity.noCity') }}</p>
    <p class="text-sm">{{ $t('currentCity.selectCityPrompt') }}</p>
  </div>

  <!-- AI : Use ProjectAccordionPanel to display current city's projects -->
  <ProjectAccordionPanel
    v-else
    :projects="projectsWithOverlays"
    :is-loading="false"
    :on-overlay-click="handleOverlayClick"
    :hide-status-badges="true"
    :disable-auto-mode-switch="true"
    :disable-grouping="true"
    title=""
    panel-class="current-city-panel"
    :empty-message="$t('currentCity.noProjects')"
    :empty-sub-message="$t('currentCity.noProjectsDetail')"
  >
    <!-- AI : Custom header showing Country > City -->
    <template #header-actions>
      <div class="header-actions-container">
        <span v-if="cityHeader" class="city-header">
          <span
            class="country-link"
            @click="handleCountryClick"
            :title="$t('currentCity.clickToZoomCountry')"
          >
            {{ cityHeader.countryName }}
          </span>
          <i class="pi pi-angle-right separator"></i>
          <span class="city-name">{{ cityHeader.cityName }}</span>
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
import { prepareCountryContext, isValidCountryCode } from '@/composables/map/useCountryMarkers'
import { flyToCountry } from '@/composables/map/useMapNavigation'
import { useAccordionState } from '@/composables/layout/useAccordionState'
import { useNewProject } from '@/composables/overlay/useNewProject'
import { useToast } from '@/composables/ui/useToast'
import ProjectAccordionPanel from './ProjectAccordionPanel.vue'
import type { ProjectForModeration, OverlayForModeration } from '@/types/index'

// AI : Stores
const { t } = useI18n()
const mapStore = useMapStore()
const overlayStore = useOverlayStore()
const projectStore = useProjectStore()
const toast = useToast()

// AI : Get accordion state to manually expand when needed
const { expandAccordionForOverlay } = useAccordionState()

// AI : New project composable
const { handleNewProjectClick } = useNewProject()

// AI : Handle add overlay button click
async function handleAddOverlayClick() {
    const result = await handleNewProjectClick()

    if (!result.success && result.reason === 'edit_mode_error') {
        toast.add({
            severity: 'error',
            summary: t('moderation.modeSwitchError'),
            detail: t('moderation.modeSwitchErrorDetail'),
            life: 3000
        })
    }
    // AI : No toast for success - dialog opening is self-explanatory
}

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

// AI : Handle country click - zoom to country view (same as country marker click)
async function handleCountryClick() {
    const header = cityHeader.value
    if (!header) return

    if (!isValidCountryCode(header.countryCode)) return

    // AI : Fly to the country using its centroid
    flyToCountry(header.countryCode, header.lat, header.lng)

    // AI : Prepare country context (clear map, load cities, add markers)
    await prepareCountryContext(header.countryCode)
}

// AI : Custom overlay click handler that doesn't switch to edit mode (like Latest Contributions)
const { handleOverlayClickNavigation } = useOverlayClickHandler()

async function handleOverlayClick(overlay: OverlayForModeration, shouldFitBounds: boolean) {
    // AI : Pass false for shouldToggleEditMode to prevent unwanted mode switching
    // AI : This matches the behavior of Latest Contributions panel
    await handleOverlayClickNavigation(overlay, false)
}

// AI : Build projects with overlays from already-loaded mapStore data
const projectsWithOverlays = computed(() => {
    if (!mapStore.selectedCity) {
        return []
    }

    // AI : Group overlays by project from currentCityOverlays (already loaded when city is clicked)
    const projectsMap = new Map<string, ProjectForModeration>()

    for (const overlayData of mapStore.currentCityOverlays) {
        const projectId = overlayData.projectId
        if (!projectId) continue

        if (!projectsMap.has(projectId)) {
            // AI : Create project entry from overlay data's project field
            const projectInfo = overlayData.project
            projectsMap.set(projectId, {
                id: projectId,
                name: projectInfo?.name ?? projectId,
                description: projectInfo?.description ?? null,
                status: (projectInfo?.status ?? 'approved') as any,
                ownerId: projectInfo?.ownerId ?? overlayData.authorId,
                cityId: projectInfo?.cityId ?? mapStore.selectedCity.id,
                lat: projectInfo?.lat ?? overlayData.centroid.lat,
                lng: projectInfo?.lng ?? overlayData.centroid.lng,
                proposalDate: projectInfo?.proposalDate ?? null,
                startDate: projectInfo?.startDate ?? null,
                endDate: projectInfo?.endDate ?? null,
                sourceUrl: projectInfo?.sourceUrl ?? null,
                createdAt: projectInfo?.createdAt ?? overlayData.createdAt,
                updatedAt: projectInfo?.updatedAt ?? overlayData.updatedAt,
                version: projectInfo?.version ?? overlayData.version,
                countryCode: projectInfo?.city?.countryCode ?? mapStore.selectedCity.countryCode ?? null,
                countryName: (() => {
                    // AI : Get country name from projectStore using country code
                    const code = projectInfo?.city?.countryCode ?? mapStore.selectedCity.countryCode
                    if (!code) return null
                    const country = projectStore.countries.find(c => c.code === code)
                    return country?.name ?? null
                })(),
                cityName: projectInfo?.city?.name ?? mapStore.selectedCity.name,
                overlays: []
            })
        }

        const project = projectsMap.get(projectId)!

        const overlay: OverlayForModeration = {
            id: overlayData.id,
            name: overlayData.caption ?? '',
            filename: overlayData.filename,
            status: overlayData.status,
            version: overlayData.version,
            projectId: overlayData.projectId,
            updatedAt: overlayData.updatedAt,
            authorId: overlayData.authorId,
            authorUsername: undefined,
            authorReportCount: undefined,
            cityId: overlayData.project?.cityId ?? mapStore.selectedCity.id,
            cityName: overlayData.project?.city?.name ?? mapStore.selectedCity.name,
            countryCode: overlayData.project?.city?.countryCode ?? mapStore.selectedCity.countryCode ?? null,
            countryName: null,
            replacesOverlayId: overlayData.replacesOverlayId
        }

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
                countryName: (() => {
                    // AI : Get country name from projectStore using country code
                    const code = standaloneSummary.city.countryCode
                    if (!code) return null
                    const country = projectStore.countries.find(c => c.code === code)
                    return country?.name ?? null
                })(),
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

/* AI : Header actions container - matches MyContributionsPanel pattern */
.header-actions-container {
    display: flex;
    gap: 1rem;
    align-items: center;
    flex-wrap: wrap;
    justify-content: space-between;
    width: 100%;
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
}

.country-link {
    color: var(--p-primary-500);
    cursor: pointer;
    transition: all 0.2s ease;
    padding: 0.25rem 0.5rem;
    border-radius: var(--p-border-radius);
    margin: -0.25rem -0.5rem;
}

.country-link:hover {
    color: var(--p-primary-600);
    background-color: var(--p-primary-50);
}

.separator {
    color: var(--p-surface-500);
    font-size: 0.875rem;
    margin: 0 0.125rem;
}

.city-name {
    color: var(--p-surface-800);
    font-weight: 600;
}
</style>
