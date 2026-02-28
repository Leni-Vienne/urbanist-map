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
    class="flex flex-col h-full"
  >
    <div class="p-4 border-b border-surface-100 bg-surface-0">
      <h3 class="m-0 text-base font-semibold text-surface-800">
        {{ selectedCountryName }}
      </h3>
      <p class="mt-1 text-[0.8125rem] text-surface-500">
        {{ $t("currentLocation.selectCityToExplore") }}
      </p>
    </div>

    <!-- AI : No cities state -->
    <PanelEmptyState
      v-if="citiesInCountry.length === 0"
      icon="map"
      :message="$t('currentLocation.noCitiesInCountry')"
    />

    <!-- AI : City list -->
    <div v-else ref="cityListRef" class="flex-1 overflow-y-auto p-2">
      <button
        v-for="city in citiesInCountry"
        :key="city.id"
        class="w-full flex items-center justify-between px-4 py-[0.875rem] border-none bg-surface-0 rounded cursor-pointer transition-all duration-150 mb-2 text-left hover:bg-surface-50 hover:translate-x-0.5 active:bg-surface-100"
        @click="handleCityClick(city)"
      >
        <div class="flex flex-col gap-1 flex-1 min-w-0">
          <span class="text-[0.9375rem] font-medium text-surface-800 truncate">{{
            city.name
          }}</span>
          <span
            v-if="city.nameLocal && city.nameLocal !== city.name"
            class="text-[0.8125rem] text-surface-500 italic"
          >
            {{ city.nameLocal }}
          </span>
        </div>
        <span
          class="shrink-0 text-[0.8125rem] text-surface-600 bg-surface-100 px-[0.625rem] py-1 rounded-full font-medium"
        >
          {{ $t("currentLocation.projectsCount", { count: city.projectCount ?? 0 }) }}
        </span>
      </button>
    </div>
  </div>

  <!-- AI : City selected - show project list -->
  <ProjectAccordionPanel
    v-else
    ref="projectPanelRef"
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
      <div class="flex gap-4 items-center justify-between w-full">
        <!-- AI : Always render wrapper to maintain flex layout, conditionally render content -->
        <span
          class="flex items-center gap-[0.625rem] text-base text-surface-700 font-semibold py-1 min-w-0 flex-1"
        >
          <template v-if="cityHeader">
            <span
              class="text-primary-500 cursor-pointer transition-all duration-200 py-1 px-2 rounded -my-1 -mx-2 shrink-0 hover:text-primary-600 hover:bg-primary-50"
              @click="handleCountryClick"
              :title="$t('currentLocation.clickToZoomCountry')"
            >
              {{ cityHeader.countryName }}
            </span>
            <i class="pi pi-angle-right text-surface-500 text-sm mx-[0.125rem] shrink-0"></i>
            <span
              class="text-primary-500 cursor-pointer transition-all duration-200 py-1 px-2 rounded -my-1 -mx-2 overflow-hidden text-ellipsis whitespace-nowrap min-w-0 hover:text-primary-600 hover:bg-primary-50"
              :class="{ 'text-surface-900': cityLinkClicked }"
              @click="handleBreadcrumbCityClick"
              >{{ cityHeader.cityName }}</span
            >
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
import { computed, ref, onActivated, onDeactivated, onUnmounted, nextTick } from "vue";
import { useI18n } from "vue-i18n";
import { useNewProject } from "@/composables/overlay/useNewProject";
import { useToast } from "@/composables/ui/useToast";
import { useMapStore } from "@/stores/pinia/mapStore";
import { useOverlayStore } from "@/stores/pinia/overlayStore";
import { useProjectStore } from "@/stores/pinia/projectStore";
import { isValidCountryCode } from "@/services/map/countryData";
import { flyToCountry, mobileAwareFlyTo } from "@/services/map/mapNavigation";
import {
  smartZoomToCity,
  citiesWithProjects,
  type CityWithProjects,
} from "@/services/map/cityMarkers";
import { map } from "@/services/core/map";
import { loadCityProjects } from "@/services/navigation/locationNavigation";
import { createProjectFromOverlayData, createOverlayForModeration } from "@/utils/projectFactories";

import ProjectAccordionPanel from "@/components/layout/ProjectAccordionPanel.vue";
import PanelEmptyState from "@/components/common/PanelEmptyState.vue";
import type { ProjectForModeration, OverlayForModeration } from "@/types/index";

// AI : Stores
const mapStore = useMapStore();
const overlayStore = useOverlayStore();
const projectStore = useProjectStore();

const { t } = useI18n();
const toast = useToast();
const { handleNewProjectClick } = useNewProject();

// AI : Handle new project button click with error feedback
async function handleAddOverlayClick() {
  const result = await handleNewProjectClick();
  if (!result.success && result.reason === "edit_mode_error") {
    toast.add({
      severity: "error",
      summary: t("moderation.modeSwitchError"),
      detail: t("moderation.modeSwitchErrorDetail"),
      life: 3000,
    });
  }
}

// AI : Scroll state preservation
const cityListRef = ref<HTMLElement | null>(null);
const projectPanelRef = ref<any | null>(null); // AI : Type as any to access $el
const savedScrollTop = ref(0);
const savedScrollTarget = ref<"city" | "project" | null>(null);

// AI : Helper to find the actual scrolling element
function findScrollableElement(startElement: HTMLElement | null): HTMLElement | null {
  if (!startElement) return null;

  if (
    startElement.scrollHeight > startElement.clientHeight &&
    (getComputedStyle(startElement).overflowY === "auto" ||
      getComputedStyle(startElement).overflowY === "scroll")
  ) {
    return startElement;
  }

  // AI : Check children up to a reasonable depth
  const children = startElement.querySelectorAll("*");
  for (const child of children) {
    if (
      child.scrollHeight > child.clientHeight &&
      (getComputedStyle(child).overflowY === "auto" ||
        getComputedStyle(child).overflowY === "scroll")
    ) {
      return child as HTMLElement;
    }
  }

  return null;
}

// AI : Compute header showing "Country > City"
const cityHeader = computed(() => {
  if (!mapStore.selectedCity) return null;

  const { countryCode, name: cityName } = mapStore.selectedCity;
  if (!countryCode) return null;

  // AI : Find country name from countries list
  const country = projectStore.countries.find((c) => c.code === countryCode);
  if (!country) return null;

  return {
    countryName: country.name,
    countryCode,
    cityName,
    lat: country.lat,
    lng: country.lng,
  };
});

// AI : Compute selected country name for city list header
const selectedCountryName = computed(() => {
  if (!mapStore.selectedCountryCode) return "";
  const country = projectStore.countries.find((c) => c.code === mapStore.selectedCountryCode);
  return country?.name ?? mapStore.selectedCountryCode;
});

// AI : Get cities in selected country from global city list (viewport loading loads cities globally)
const citiesInCountry = computed(() => {
  if (!mapStore.selectedCountryCode) return [];
  // AI : Use globally loaded cities ref and filter by country code
  return citiesWithProjects.value.filter(
    (city: CityWithProjects) => city.countryCode === mapStore.selectedCountryCode,
  );
});

// AI : Handle city selection from list
function handleCityClick(city: {
  id: number;
  name: string;
  nameLocal: string | null;
  countryCode: string;
  lat: number;
  lng: number;
}) {
  // AI : Set the selected city first
  mapStore.setSelectedCity({
    id: city.id,
    name: city.name,
    nameLocal: city.nameLocal,
    countryCode: city.countryCode,
  });

  // AI : Fly to the city (same behavior as city marker click)
  if (map.value.getZoom() < 14) {
    mobileAwareFlyTo([city.lat, city.lng], 14, {
      duration: 1.5,
    });
  }

  // AI : Set selected city state and navigate to city
  loadCityProjects(city.id, city.name, city.nameLocal, city.countryCode);
}

// AI : Handle country click - zoom to country view AND clear selected city to show city list
async function handleCountryClick() {
  const header = cityHeader.value;
  if (!header) return;

  if (!isValidCountryCode(header.countryCode)) return;

  flyToCountry(header.countryCode);

  // AI : Set the selected country code (for tile layer management)
  mapStore.selectedCountryCode = header.countryCode;

  // AI : Clear the selected city to show the city list panel
  mapStore.clearSelectedCity();
}

// AI : City breadcrumb clicked state - true until the user manually moves the map
const cityLinkClicked = ref(false);
let dragStartHandler: (() => void) | null = null;
let zoomStartHandler: (() => void) | null = null;

function detachCityLinkHandlers() {
  if (dragStartHandler) {
    map.value.off("dragstart", dragStartHandler);
    dragStartHandler = null;
  }
  if (zoomStartHandler) {
    map.value.off("zoomstart", zoomStartHandler);
    zoomStartHandler = null;
  }
}

onUnmounted(detachCityLinkHandlers);

// AI : Handle city breadcrumb click - smart zoom to fit all city content
function handleBreadcrumbCityClick() {
  const selectedCity = mapStore.selectedCity;
  if (!selectedCity) return;
  const city = citiesWithProjects.value.find((c: CityWithProjects) => c.id === selectedCity.id);
  if (!city) return;

  cityLinkClicked.value = true;
  detachCityLinkHandlers();

  // AI : Manual drag clears state immediately
  dragStartHandler = () => {
    cityLinkClicked.value = false;
    detachCityLinkHandlers();
  };
  map.value.once("dragstart", dragStartHandler);

  // AI : After the programmatic fly ends, manual zoom also clears state
  map.value.once("moveend", () => {
    zoomStartHandler = () => {
      cityLinkClicked.value = false;
      zoomStartHandler = null;
      if (dragStartHandler) {
        map.value.off("dragstart", dragStartHandler);
        dragStartHandler = null;
      }
    };
    map.value.once("zoomstart", zoomStartHandler);
  });

  const overlays =
    mapStore.getCityOverlaysAndProjectsCache(selectedCity.id, overlayStore.mode) ?? [];
  const projects =
    mapStore.getCityStandaloneProjectsCache(selectedCity.id, overlayStore.mode) ?? [];
  smartZoomToCity(city, { overlays, projects });
}

// AI : Custom overlay click handler - lazily imported since it's only reachable after city selection
async function handleOverlayClick(overlay: OverlayForModeration): Promise<void> {
  const { useOverlayClickHandler } = await import("@/composables/overlay/useOverlayClickHandler");
  const { handleOverlayClickNavigation } = useOverlayClickHandler();
  await handleOverlayClickNavigation(overlay, false);
}

// AI : Build projects with overlays from mode-aware cache
const projectsWithOverlays = computed(() => {
  if (!mapStore.selectedCity) {
    return [];
  }

  // AI : Get overlays from mode-aware cache (same pattern as standalone projects)
  // AI : This ensures view mode only shows approved overlays, edit mode shows approved + user's own
  const overlaysForMode =
    mapStore.getCityOverlaysAndProjectsCache(mapStore.selectedCity.id, overlayStore.mode) ?? [];

  // AI : Group overlays by project
  const projectsMap = new Map<string, ProjectForModeration>();

  for (const overlayData of overlaysForMode) {
    const projectId = overlayData.projectId;
    if (!projectId) continue;

    if (!projectsMap.has(projectId)) {
      // AI : Use factory to create project from overlay data
      projectsMap.set(
        projectId,
        createProjectFromOverlayData(overlayData, mapStore.selectedCity, projectStore.countries),
      );
    }

    const project = projectsMap.get(projectId);
    if (!project) continue;

    // AI : Use factory to create overlay
    const overlay = createOverlayForModeration(overlayData, mapStore.selectedCity);

    project.overlays = project.overlays || [];
    project.overlays.push(overlay);
  }

  // AI : Add standalone projects from cache (projects without overlays)
  const standaloneProjects =
    mapStore.cityStandaloneProjectsCache.get(mapStore.selectedCity.id)?.get(overlayStore.mode) ??
    [];

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
        proposalDatePrecision: standaloneSummary.proposalDatePrecision,
        startDate: standaloneSummary.startDate,
        startDatePrecision: standaloneSummary.startDatePrecision,
        endDate: standaloneSummary.endDate,
        endDatePrecision: standaloneSummary.endDatePrecision,
        sourceUrl: standaloneSummary.sourceUrl,
        createdAt: standaloneSummary.createdAt,
        updatedAt: standaloneSummary.updatedAt,
        version: 0, // Not in summary
        countryCode: standaloneSummary.city.countryCode ?? null,
        countryName:
          projectStore.countries.find((c) => c.code === standaloneSummary.city.countryCode)?.name ??
          null,
        cityName: standaloneSummary.city.name,
        overlays: [],
      });
    }
  }

  // AI : Convert to array and sort by name
  return [...projectsMap.values()].toSorted((a, b) => a.name.localeCompare(b.name));
});

// AI : Save scroll position when deactivating (tab switch)
onDeactivated(() => {
  if (cityListRef.value) {
    savedScrollTop.value = cityListRef.value.scrollTop;
    savedScrollTarget.value = "city";
  } else if (projectPanelRef.value?.$el) {
    const el = findScrollableElement(projectPanelRef.value.$el);
    if (el) {
      savedScrollTop.value = el.scrollTop;
      savedScrollTarget.value = "project";
    }
  } else {
    savedScrollTarget.value = null;
  }
});

// AI : Restore scroll position when activating
onActivated(() => {
  nextTick(() => {
    if (savedScrollTarget.value === "city" && cityListRef.value) {
      cityListRef.value.scrollTop = savedScrollTop.value;
    } else if (savedScrollTarget.value === "project" && projectPanelRef.value?.$el) {
      const el = findScrollableElement(projectPanelRef.value.$el);
      if (el) {
        el.scrollTop = savedScrollTop.value;
      }
    }
  });
});
</script>
