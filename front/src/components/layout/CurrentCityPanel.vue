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
    <template #empty-state>
      <i class="pi pi-folder text-5xl text-surface-400 mb-4"></i>
      <p class="text-base mb-2">{{ $t('currentCity.noProjects') }}</p>
      <p class="text-sm">{{ $t('currentCity.noProjectsDetail') }}</p>
    </template>
  </ProjectAccordionPanel>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useMapStore } from '@/stores/pinia/mapStore'
import { useOverlayStore } from '@/stores/pinia/overlayStore'
import { useOverlayClickHandler } from '@/composables/overlay/useOverlayClickHandler'
import ProjectAccordionPanel from './ProjectAccordionPanel.vue'
import type { ProjectForModeration, OverlayForModeration } from '@/types/index'

// AI : Stores
const { t } = useI18n()
const mapStore = useMapStore()
const overlayStore = useOverlayStore()

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
                countryName: null, // AI : Not available in data
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
                countryName: null, // AI : Not available in summary
                cityName: standaloneSummary.city.name,
                overlays: []
            })
        }
    }

    // AI : Convert to array and sort by name
    return [...projectsMap.values()].toSorted((a, b) => a.name.localeCompare(b.name))
})
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
</style>
