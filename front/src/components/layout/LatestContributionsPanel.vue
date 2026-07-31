<template>
  <div class="relative h-full flex flex-col">
    <!-- Controls. On desktop the filter surface opens in a popover here, so narrowing the list
         never costs a navigation away from it; on mobile there is no room for it beside the list,
         so it opens the Filter tab instead. -->
    <div class="shrink-0 border-b border-surface">
      <div class="flex items-center gap-2 px-2 py-2">
        <div class="shrink-0 flex items-center">
          <div role="group" :aria-label="t('contribution.filterBySource')" class="shrink-0">
            <SelectButton
              v-model="sourceSelection"
              :options="SOURCE_OPTIONS"
              option-label="label"
              option-value="value"
              multiple
              size="small"
            />
          </div>
        </div>

        <i v-if="isLoading" class="pi pi-spin pi-spinner text-sm text-muted-color shrink-0"></i>

        <div class="ml-auto min-w-0">
          <MapAreaSearchControl />
        </div>

        <div class="relative inline-flex shrink-0">
          <span
            v-if="hasPopoverFilters"
            class="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 bg-red-500 rounded-full border-2 border-content-background pointer-events-none z-10"
          />
          <Button
            @click="openFilters"
            icon="pi pi-sliders-h"
            size="small"
            severity="secondary"
            v-tooltip.top="t('contribution.moreFilters')"
            :aria-label="t('contribution.moreFilters')"
          />
        </div>
      </div>

      <!-- Applied filters, removable in place. Relaxing a filter is the common case and needs no
           trip back to the full palette. -->
      <div v-if="hasChippedFilters" class="flex flex-wrap items-center gap-1.5 px-2 pb-2">
        <button
          v-if="mapArea"
          type="button"
          class="inline-flex items-center gap-1 pl-2 pr-1.5 py-0.5 rounded-full text-[0.7rem] font-medium bg-content-hover-background text-color border border-surface cursor-pointer transition-colors duration-150 hover:bg-black/5 dark:hover:bg-white/10"
          @click="clearMapArea"
        >
          {{ t("contribution.mapArea") }}
          <i class="pi pi-times text-[0.6rem] text-muted-color"></i>
        </button>
        <button
          v-for="filter in activeFilters"
          :key="filterKey(filter)"
          type="button"
          class="inline-flex items-center gap-1 pl-2 pr-1.5 py-0.5 rounded-full text-[0.7rem] font-medium bg-content-hover-background text-color border border-surface cursor-pointer transition-colors duration-150 hover:bg-black/5 dark:hover:bg-white/10"
          @click="clearActiveFilter(filter)"
        >
          {{ filterLabel(filter) }}
          <i class="pi pi-times text-[0.6rem] text-muted-color"></i>
        </button>
      </div>

      <div v-if="showOsmSyncNotice" class="px-2 pb-1.5">
        <button
          type="button"
          class="w-full flex items-center justify-between gap-2 px-1 py-1.5 text-xs text-muted-color bg-transparent border-0 cursor-pointer transition-colors duration-150 hover:text-color"
          :aria-expanded="isOsmSyncExpanded"
          @click="isOsmSyncExpanded = !isOsmSyncExpanded"
        >
          <span class="flex items-center gap-2 min-w-0">
            <i class="pi pi-refresh text-[0.7rem] shrink-0"></i>
            <span class="truncate">{{ osmSyncLabel }}</span>
          </span>
          <i
            class="pi pi-chevron-down text-[0.65rem] shrink-0 transition-transform duration-150"
            :class="isOsmSyncExpanded ? 'rotate-180' : ''"
          ></i>
        </button>

        <div v-if="isOsmSyncExpanded" class="px-1 pb-1 pt-0.5 text-xs text-muted-color">
          <p class="m-0 mb-1.5 leading-snug">{{ t("contribution.osmDataDescription") }}</p>
          <button
            type="button"
            class="inline-flex items-center gap-1 p-0 text-xs font-medium text-primary-color bg-transparent border-0 cursor-pointer hover:text-primary-hover-color"
            @click="browseOsmUpdates"
          >
            {{ t("contribution.browseOsmUpdates") }}
            <i class="pi pi-arrow-right text-[0.65rem]"></i>
          </button>
        </div>
      </div>
    </div>

    <Popover ref="filterPopover" appendTo="body" :pt="{ root: { class: 'filter-popover' } }">
      <!-- overflow-x hidden removes the spurious horizontal scrollbar from the sliders -->
      <div
        class="min-w-55 max-w-75 overflow-y-auto overflow-x-hidden pr-1"
        style="max-height: min(600px, 70svh)"
      >
        <FilterPanelContent />
      </div>
    </Popover>

    <div ref="scrollAreaRef" class="contribution-scroll-area flex-1 min-h-0 overflow-y-auto">
      <div v-if="rows.length > 0" ref="contentRef" class="flex flex-col">
        <div
          v-for="row in rows"
          :key="row.contribution.id"
          class="group flex items-center gap-3 px-2 py-2 cursor-pointer transition-all duration-150 hover:bg-black/5 dark:hover:bg-white/10 active:bg-black/5 dark:active:bg-white/10 active:scale-[0.98]"
          @click="handleContributionClick(row.contribution)"
          @mouseenter="handleContributionHover(row.contribution)"
          @mouseleave="handleContributionLeave(row.contribution)"
        >
          <div
            class="contribution-thumbnail w-13 h-13 md:w-15 md:h-15 rounded-lg overflow-hidden shrink-0 flex items-center justify-center relative"
            :style="{ '--thumbnail-color': row.color }"
            :class="{
              'border border-surface': row.thumbnailUrl && !imageErrors[row.contribution.id],
            }"
          >
            <img
              v-if="row.thumbnailUrl && !imageErrors[row.contribution.id]"
              :src="row.thumbnailUrl"
              class="w-full h-full object-cover"
              alt=""
              :crossorigin="row.crossorigin"
              @error="(event) => handleImageError(event, row.contribution.id)"
              @load="() => handleImageLoad(row.contribution.id)"
            />
            <component
              :is="row.icon"
              v-else-if="row.icon"
              class="w-7 h-7 md:w-8 md:h-8"
              :style="{ color: row.color }"
              :stroke-width="1.5"
            />
            <ShapeThumbnail
              v-else-if="row.shape"
              :geometry="row.shape"
              class="w-11 h-11 md:w-13 md:h-13"
              :style="{ color: row.color }"
            />
            <i v-else class="pi pi-image text-2xl text-muted-color"></i>
          </div>

          <!-- Contribution info -->
          <div class="flex-1 min-w-0">
            <h2
              class="text-[13px] md:text-sm font-semibold truncate leading-tight mb-0.5"
              :class="row.isPlaceholderTitle ? 'text-muted-color italic' : 'text-color'"
            >
              {{ row.title }}
            </h2>
            <div class="text-xs text-muted-color truncate mb-0.5">
              {{ getLocationDisplay(row.contribution) }}
            </div>
            <div class="flex items-center gap-1.5 text-xs text-muted-color">
              <span>{{ formatRelativeTime(row.contribution.updatedAt, t) }}</span>
              <span class="text-surface">·</span>
              <span>{{
                row.contribution.isImport
                  ? t("contribution.sourceOsm")
                  : t("contribution.sourceCommunity")
              }}</span>
            </div>
          </div>
        </div>

        <div v-if="hasMore" ref="loadMoreSentinel" class="h-10 flex items-center justify-center">
          <i v-if="isLoadingMore" class="pi pi-spin pi-spinner text-sm text-muted-color"></i>
        </div>
      </div>

      <PanelEmptyState
        v-else-if="!isLoading && hasNarrowedQuery"
        icon="filter-slash"
        :message="t('contribution.noMatchingContributions')"
        :sub-message="t('contribution.tryWideningFilters')"
      />

      <PanelEmptyState
        v-else-if="!isLoading"
        icon="image"
        :message="t('contribution.noContributionsFound')"
        :sub-message="t('contribution.beFirstToAdd')"
      />

      <div
        v-if="isLoading && rows.length === 0"
        class="flex flex-col items-center justify-center p-12 text-center text-(--p-text-color-secondary)"
      >
        <i class="pi pi-spin pi-spinner text-2xl mb-4"></i>
        <p>{{ t("contribution.loadingContributions") }}</p>
      </div>
    </div>

    <div v-if="showScrollFade" class="scroll-fade-overlay"></div>
  </div>
</template>

<script setup lang="ts">
import { toastWarn } from "@/services/core/toast";

import {
  computed,
  nextTick,
  onActivated,
  onBeforeUnmount,
  onDeactivated,
  onMounted,
  ref,
  watch,
} from "vue";
import { useI18n } from "vue-i18n";
import { canModerateCountry } from "@/services/moderation/moderationCountrySync";
import {
  contributions,
  isLoading,
  isLoadingMore,
  hasMore,
  source,
  sourceSelection,
  mapArea,
  osmLastSyncedAt,
  showOsmSyncNotice,
  activateLatestContributions,
  loadMoreLatestContributions,
  clearMapArea,
  showOsmUpdates,
} from "@/services/feed/latestContributions";
import {
  activeFilters,
  activeFilterCount,
  clearActiveFilter,
  formatSizeM,
  type ActiveFilter,
} from "@/services/core/filters";
import { buildThumbnailUrl, imageRequiresCredentials } from "@/utils/imageUrl";
import { getProjectTagIcon, getProjectTagColor, getProjectTagSlug } from "@/constants/projectTags";
import ShapeThumbnail from "@/components/common/ShapeThumbnail.vue";
import PanelEmptyState from "@/components/common/PanelEmptyState.vue";
import FilterPanelContent from "@/components/map/FilterPanelContent.vue";
import MapAreaSearchControl from "@/components/map/MapAreaSearchControl.vue";
import { formatRelativeTime } from "@/utils/dateFormat";
import { useImageErrors } from "@/composables/ui/useImageErrors";
import { useMapStore } from "@/stores/mapStore";
import { useUiStore } from "@/stores/uiStore";
import { isMobile } from "@/services/core/viewport";

import { useScrollFade } from "@/composables/ui/useScrollFade";
import {
  navigateToProject,
  navigateToProjectBounds,
  zoomToOverlayAndSelect,
} from "@/services/navigation/projectNavigation";
import type { LatestContribution } from "@/types/index";
import { highlightOverlayById, removeOverlayHighlight } from "@/services/overlay/selection";
import { mobileAwareFlyTo } from "@/services/core/mapNavigation";
import { LngLatBounds } from "maplibre-gl";

const { t, te, locale } = useI18n();
const mapStore = useMapStore();
const uiStore = useUiStore();

const { imageErrors, handleImageError, handleImageLoad } = useImageErrors();
const isOsmSyncExpanded = ref(false);

const SOURCE_OPTIONS = computed(() => [
  { value: "community" as const, label: t("contribution.sourceCommunity") },
  { value: "osm" as const, label: t("contribution.sourceOsmShort") },
]);

// Drives the empty-state copy: an empty list means something different when the query was narrowed.
const hasNarrowedQuery = computed(
  () => activeFilterCount.value > 0 || source.value !== "all" || mapArea.value !== null,
);

// Everything reachable only through the popover, so the button can show that something is applied.
const hasPopoverFilters = computed(() => activeFilterCount.value > 0);
const hasChippedFilters = computed(() => activeFilters.value.length > 0 || mapArea.value !== null);
const osmSyncLabel = computed(() =>
  t("contribution.osmDataUpdated", {
    time: formatRelativeTime(osmLastSyncedAt.value, t),
  }),
);

function browseOsmUpdates(): void {
  isOsmSyncExpanded.value = false;
  showOsmUpdates();
}

function getContributionImageUrl(filename: string): string {
  return buildThumbnailUrl(filename);
}

// Overlays use their own image; standalone projects fall back to their render thumbnail (if any).
function getThumbnailFilename(contribution: LatestContribution): string | null {
  if (contribution.type === "overlay") {
    return contribution.filename;
  }
  return contribution.renderFilename;
}

// A nameless contribution is described by its category rather than announced as missing, so the
// row still says what the thing is. Only an untagged one falls back to a placeholder.
function getTitle(contribution: LatestContribution): { title: string; isPlaceholder: boolean } {
  if (contribution.name) {
    return { title: contribution.name, isPlaceholder: false };
  }
  const slug = getProjectTagSlug(contribution.tags);
  if (slug) {
    return { title: t(`tags.${slug}`), isPlaceholder: false };
  }
  const fallback = contribution.type === "overlay" ? "overlay.untitled" : "project.unnamed";
  return { title: t(fallback), isPlaceholder: true };
}

// Resolve the thumbnail URL, crossorigin flag, title, category icon, tag color and shape once per
// contribution, instead of recomputing them several times each in the template.
const rows = computed(() =>
  contributions.value.map((contribution) => {
    const filename = getThumbnailFilename(contribution);
    const thumbnailUrl = filename ? getContributionImageUrl(filename) : null;
    const { title, isPlaceholder } = getTitle(contribution);
    return {
      contribution,
      thumbnailUrl,
      title,
      isPlaceholderTitle: isPlaceholder,
      icon: getProjectTagIcon(contribution.tags),
      color: getProjectTagColor(contribution.tags),
      shape: contribution.type === "standalone" ? contribution.shape : null,
      crossorigin:
        thumbnailUrl && imageRequiresCredentials(thumbnailUrl)
          ? ("use-credentials" as const)
          : undefined,
    };
  }),
);

const filterPopover = ref<{ toggle(event: Event): void } | null>(null);

function openFilters(event: Event) {
  if (isMobile.value) {
    uiStore.activeTab = "filter";
    return;
  }
  filterPopover.value?.toggle(event);
}

function filterKey(filter: ActiveFilter): string {
  return JSON.stringify(filter);
}

function formatFilterDate(ms: number): string {
  return new Date(ms).toLocaleDateString(locale.value);
}

function filterLabel(filter: ActiveFilter): string {
  switch (filter.kind) {
    case "tag":
      return te(`tags.${filter.slug}`) ? t(`tags.${filter.slug}`) : filter.slug;
    case "untagged":
      return t("map.controls.untagged");
    case "status":
      return t(`timelineStatus.${filter.status}`);
    case "name":
      return t(`map.controls.${filter.value}`);
    case "size":
      return filter.min > 0 ? `≥ ${formatSizeM(filter.min)}` : `≤ ${formatSizeM(filter.max)}`;
    case "date":
      return filter.min > 0
        ? `${t("map.controls.lastModifiedFrom")} ${formatFilterDate(filter.min)}`
        : `${t("map.controls.lastModifiedTo")} ${formatFilterDate(filter.max)}`;
    case "images":
      return t("map.controls.onlyWithImages");
    default:
      return "";
  }
}

// Prefer the name in the current UI locale, falling back to English, then the boundary's local name.
function localizedName(level: LatestContribution["city"]): string | null {
  if (!level) {
    return null;
  }
  return level.names?.[locale.value] ?? level.nameEn ?? level.name;
}

// Builds "City, State, Country (CODE)" from the boundary-derived levels, skipping missing levels and
// collapsing duplicate names (city-states like Berlin repeat the same name across levels).
function getLocationDisplay(contribution: LatestContribution): string {
  const parts: string[] = [];
  for (const level of [contribution.city, contribution.state, contribution.country]) {
    const name = localizedName(level);
    if (name && !parts.includes(name)) {
      parts.push(name);
    }
  }
  const place = parts.join(", ");
  if (place && contribution.countryCode) {
    return `${place} (${contribution.countryCode})`;
  }
  if (place) {
    return place;
  }
  if (contribution.countryCode) {
    return contribution.countryCode;
  }
  return t("project.noLocation");
}

function handleContributionHover(contribution: LatestContribution) {
  if (contribution.type === "overlay") {
    highlightOverlayById(contribution.id);
  }
}

function handleContributionLeave(contribution: LatestContribution) {
  if (contribution.type === "overlay") {
    removeOverlayHighlight(contribution.id);
  }
}

async function handleContributionClick(contribution: LatestContribution) {
  // In moderation mode, auto-select the country for the moderation panel
  // Block navigation if the moderator can't moderate this country
  if (mapStore.mode === "moderation" && contribution.countryCode) {
    if (!canModerateCountry(contribution.countryCode)) {
      toastWarn(t("moderation.noAccessToThisCountry"), t("moderation.title"));
      return;
    }
    mapStore.setSelectedCountryCode(contribution.countryCode);
  }

  if (contribution.type === "overlay") {
    if (contribution.corners) {
      zoomToOverlayAndSelect(contribution.id, contribution.corners);
    } else if (contribution.centroid) {
      mobileAwareFlyTo([contribution.centroid.lat, contribution.centroid.lng], 18);
    } else {
      console.warn("Contribution has no location data to fly to!", contribution);
    }
  } else if (contribution.type === "standalone") {
    if (contribution.geometryBbox) {
      // Fly to the actual geometry bounds instead of the project center point.
      const { minLat, maxLat, minLng, maxLng } = contribution.geometryBbox;
      const bounds = new LngLatBounds([minLng, minLat], [maxLng, maxLat]);
      navigateToProjectBounds(bounds, contribution.id);
    } else if (typeof contribution.lat === "number" && typeof contribution.lng === "number") {
      navigateToProject(contribution.lat, contribution.lng, contribution.id);
    }
  }
}

const scrollAreaRef = ref<HTMLElement | null>(null);
const contentRef = ref<HTMLElement | null>(null);
const loadMoreSentinel = ref<HTMLElement | null>(null);
const { showScrollFade } = useScrollFade(scrollAreaRef, contentRef);

let loadMoreObserver: IntersectionObserver | null = null;

function resetScrollForRefresh(loading: boolean): void {
  if (loading) {
    scrollAreaRef.value?.scrollTo({ top: 0 });
  }
}

function observeLoadMore(): void {
  loadMoreObserver?.disconnect();

  const root = scrollAreaRef.value;
  const sentinel = loadMoreSentinel.value;
  if (!root || !sentinel || !hasMore.value) return;

  loadMoreObserver ??= new IntersectionObserver(handleLoadMoreIntersect, {
    root,
    rootMargin: "0px 0px 240px",
  });
  loadMoreObserver.observe(sentinel);
}

function handleLoadMoreIntersect(entries: IntersectionObserverEntry[]): void {
  if (!entries.some((entry) => entry.isIntersecting) || isLoadingMore.value || !hasMore.value) {
    return;
  }
  void loadMoreLatestContributions();
}

function stopObservingLoadMore(): void {
  loadMoreObserver?.disconnect();
}

watch(
  () => [loadMoreSentinel.value, hasMore.value, isLoadingMore.value],
  () => {
    void nextTick().then(observeLoadMore);
  },
  { flush: "post" },
);

watch(isLoading, resetScrollForRefresh);

onMounted(observeLoadMore);
onActivated(observeLoadMore);
onDeactivated(stopObservingLoadMore);
onBeforeUnmount(stopObservingLoadMore);

onActivated(activateLatestContributions);
</script>

<style scoped>
.contribution-scroll-area {
  scrollbar-width: thin;
  scrollbar-color: var(--p-text-muted-color) transparent;
}

.contribution-scroll-area::-webkit-scrollbar {
  width: 0.55rem;
}

.contribution-scroll-area::-webkit-scrollbar-track {
  background: transparent;
}

.contribution-scroll-area::-webkit-scrollbar-thumb {
  background: var(--p-text-muted-color);
  border: 2px solid transparent;
  border-radius: 999px;
  background-clip: padding-box;
}

.contribution-thumbnail {
  background-color: color-mix(in srgb, var(--thumbnail-color) 10%, transparent);
}
</style>
