<template>
  <div class="relative h-full flex flex-col">
    <!-- Controls. On desktop the filter surface opens in a popover here, so narrowing the list
         never costs a navigation away from it; on mobile there is no room for it beside the list,
         so it opens the Filter tab instead. -->
    <div class="shrink-0 border-b border-surface">
      <div class="flex items-center gap-2 px-2 py-2">
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

        <span
          v-if="projectCount !== null"
          class="min-w-0 truncate text-xs text-muted-color transition-opacity duration-150"
          :class="isCountStale ? 'opacity-50' : ''"
          aria-live="polite"
        >
          {{ projectCountLabel }}
        </span>
        <span v-else-if="isCountStale" class="text-xs text-muted-color" aria-hidden="true">…</span>

        <i v-if="isLoading" class="pi pi-spin pi-spinner text-sm text-muted-color shrink-0"></i>

        <div class="relative ml-auto inline-flex shrink-0">
          <span
            v-if="showFilterDot"
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
          :ref="(element) => registerRow(row.contribution.id, element)"
          class="group flex items-center gap-3 px-2 py-2 cursor-pointer transition-all duration-150 hover:bg-black/5 dark:hover:bg-white/10 active:bg-black/5 dark:active:bg-white/10 active:scale-[0.98]"
          :class="{ 'contribution-row-selected': isSelectedRow(row.contribution) }"
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
              @error="() => handleImageError(row.contribution.id)"
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
            <div v-if="row.subtitle" class="text-xs text-muted-color truncate mb-0.5">
              {{ row.subtitle }}
            </div>
            <div class="text-xs text-muted-color">
              {{ formatRelativeTime(row.contribution.updatedAt, t) }}
            </div>
          </div>
        </div>

        <div v-if="hasMore" ref="loadMoreSentinel" class="h-10 flex items-center justify-center">
          <i v-if="isLoadingMore" class="pi pi-spin pi-spinner text-sm text-muted-color"></i>
        </div>

        <!-- End of a community-only list: the rest of the map's activity is one toggle away, and the
             end of the list is where that is worth offering. -->
        <div
          v-else-if="showOsmInvite"
          class="flex flex-col items-center gap-1 px-2 py-4 text-center border-t border-surface"
        >
          <span class="text-xs text-muted-color">{{ t("contribution.endOfCommunityFeed") }}</span>
          <button
            type="button"
            class="inline-flex items-center gap-1 p-0 text-xs font-medium text-primary-color bg-transparent border-0 cursor-pointer hover:text-primary-hover-color"
            @click="showOsmUpdates"
          >
            {{ t("contribution.switchToOsm") }}
            <i class="pi pi-arrow-right text-[0.65rem]"></i>
          </button>
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
import {
  contributions,
  isLoading,
  isLoadingMore,
  isCountStale,
  projectCount,
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
import { getProjectTagIcon, getProjectTagColor } from "@/constants/projectTags";
import ShapeThumbnail from "@/components/common/ShapeThumbnail.vue";
import PanelEmptyState from "@/components/common/PanelEmptyState.vue";
import FilterPanelContent from "@/components/map/FilterPanelContent.vue";
import { formatRelativeTime } from "@/utils/dateFormat";
import { boundaryLocationParts, formatBoundaryLocation } from "@/utils/locationDisplay";
import { useImageErrors } from "@/composables/ui/useImageErrors";
import { useFocusStore } from "@/stores/focusStore";
import { useUiStore } from "@/stores/uiStore";
import { isMobile } from "@/services/core/viewport";
import { filtersSeen } from "@/services/core/settings";

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
const uiStore = useUiStore();
const focusStore = useFocusStore();

const { imageErrors, handleImageError } = useImageErrors();
const isOsmSyncExpanded = ref(false);

const SOURCE_OPTIONS = computed(() => [
  { value: "community" as const, label: t("contribution.sourceCommunity") },
  { value: "osm" as const, label: t("contribution.sourceOsm") },
]);

// Drives the empty-state copy: an empty list means something different when the query was narrowed.
const hasNarrowedQuery = computed(
  () => activeFilterCount.value > 0 || source.value !== "all" || mapArea.value !== null,
);

const showOsmInvite = computed(() => source.value === "community" && !hasMore.value);

// Everything reachable only through the popover, so the button can show that something is applied.
const hasPopoverFilters = computed(() => activeFilterCount.value > 0 || mapArea.value !== null);
// Before the filter surface has ever been opened the dot is a discovery hint instead.
const showFilterDot = computed(() => hasPopoverFilters.value || !filtersSeen.value);
const hasChippedFilters = computed(() => activeFilters.value.length > 0 || mapArea.value !== null);
const osmSyncLabel = computed(() =>
  t("contribution.osmDataUpdated", {
    time: formatRelativeTime(osmLastSyncedAt.value, t),
  }),
);
const projectCountLabel = computed(formatProjectCount);

function formatProjectCount(): string {
  const count = projectCount.value;
  if (count === null) return "";
  const formatted = new Intl.NumberFormat(locale.value).format(count);
  const key = count === 1 ? "contribution.projectCountOne" : "contribution.projectCountMany";
  return t(key, { count: formatted });
}

function browseOsmUpdates(): void {
  isOsmSyncExpanded.value = false;
  showOsmUpdates();
}

// Overlays use their own image; standalone projects fall back to their render thumbnail (if any).
function getThumbnailFilename(contribution: LatestContribution): string | null {
  if (contribution.type === "overlay") {
    return contribution.filename;
  }
  return contribution.renderFilename;
}

// A nameless contribution is identified by where it is: the deepest known place becomes its title
// and the rest of the breadcrumb its subtitle, its category being carried by the icon tile. Only
// one that is nameless and placeless falls back to a placeholder.
function getHeadings(contribution: LatestContribution): {
  title: string;
  isPlaceholder: boolean;
  subtitle: string;
} {
  if (contribution.name) {
    const location = formatBoundaryLocation(contribution, locale.value);
    return {
      title: contribution.name,
      isPlaceholder: false,
      subtitle: location || t("project.noLocation"),
    };
  }
  const [place, ...ancestors] = boundaryLocationParts(contribution, locale.value);
  if (place) {
    const trail = ancestors.join(", ");
    const code = contribution.countryCode;
    return {
      title: place,
      isPlaceholder: false,
      subtitle: trail && code ? `${trail} (${code})` : trail,
    };
  }
  const fallback = contribution.type === "overlay" ? "overlay.untitled" : "project.unnamed";
  return { title: t(fallback), isPlaceholder: true, subtitle: t("project.noLocation") };
}

// Resolve the thumbnail URL, crossorigin flag, headings, category icon, tag color and shape once
// per contribution, instead of recomputing them several times each in the template.
const rows = computed(() =>
  contributions.value.map((contribution) => {
    const filename = getThumbnailFilename(contribution);
    const thumbnailUrl = filename ? buildThumbnailUrl(filename) : null;
    const { title, isPlaceholder, subtitle } = getHeadings(contribution);
    return {
      contribution,
      thumbnailUrl,
      title,
      subtitle,
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

// The row whose detail is docked above the list, so the list still says which one the panel
// describes. An overlay selection carries its parent project id too, so match on the row's own kind.
function isSelectedRow(contribution: LatestContribution): boolean {
  return contribution.type === "overlay"
    ? contribution.id === focusStore.selectedOverlayId
    : contribution.id === focusStore.selectedProjectId;
}

const scrollAreaRef = ref<HTMLElement | null>(null);
const contentRef = ref<HTMLElement | null>(null);
const loadMoreSentinel = ref<HTMLElement | null>(null);
const { showScrollFade } = useScrollFade(scrollAreaRef, contentRef);

const selectedRowId = computed(() => focusStore.selectedOverlayId ?? focusStore.selectedProjectId);

const rowElements = new Map<string, HTMLElement>();

function registerRow(id: string, element: unknown): void {
  if (element instanceof HTMLElement) {
    rowElements.set(id, element);
  } else {
    rowElements.delete(id);
  }
}

// Opening the detail claims height from the list, which can leave the picked row below the fold.
// Centering keeps it visible through the shrink; a selection made on the map is simply absent here.
function revealSelectedRow(id: string | null): void {
  if (!id) return;
  rowElements.get(id)?.scrollIntoView({ block: "center", behavior: "smooth" });
}

watch(selectedRowId, revealSelectedRow, { flush: "post" });

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

.contribution-row-selected {
  background-color: color-mix(in srgb, var(--p-primary-color) 10%, transparent);
}
</style>
