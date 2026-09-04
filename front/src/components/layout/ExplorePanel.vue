<template>
  <div class="relative h-full min-h-0">
    <div ref="scrollAreaRef" class="contribution-scroll-area h-full min-h-0 overflow-y-auto">
      <div ref="contentRef" class="min-h-full">
        <Transition name="detail-dock">
          <div v-if="showInlineDetail" class="detail-dock">
            <div class="detail-dock-inner p-2">
              <div class="detail-card">
                <ProjectDetailPanel :scrollable="false" />
              </div>
            </div>
          </div>
        </Transition>

        <!-- Controls. On desktop the filter surface opens in a popover here, so narrowing the list
             never costs a navigation away from it; on mobile there is no room for it beside the list,
             so it opens the Filter tab instead. -->
        <div class="sticky top-0 z-10 bg-content-background border-b border-surface">
          <div class="px-2 py-2 flex items-center gap-2">
            <span
              v-if="projectCount !== null"
              class="min-w-0 truncate text-xs text-muted-color transition-opacity duration-150"
              :class="isCountStale ? 'opacity-50' : ''"
              aria-live="polite"
            >
              {{ projectCountLabel }}
            </span>
            <span v-else-if="isCountStale" class="text-xs text-muted-color" aria-hidden="true">
              …
            </span>
            <i
              v-if="isLoading"
              class="pi pi-spin pi-spinner text-[11px] text-muted-color shrink-0"
            ></i>

            <label
              for="explore-include-osm"
              class="ml-auto inline-flex shrink-0 cursor-pointer items-center gap-1.5 text-xs text-color"
            >
              <ToggleSwitch
                input-id="explore-include-osm"
                v-model="isOsmIncluded"
                class="explore-osm-switch"
              />
              <span>{{ t("contribution.includeOsm") }}</span>
            </label>

            <div class="relative inline-flex shrink-0">
              <span
                v-if="showFilterDot"
                class="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 bg-red-500 rounded-full border-2 border-content-background pointer-events-none z-10"
              />
              <Button
                @click="openFilters"
                icon="pi pi-sliders-h"
                :label="t('navigation.filter')"
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
              class="inline-flex items-center gap-1 pl-2 pr-1.5 py-0.5 rounded-full text-[0.7rem] font-medium bg-(--p-content-hover-background) text-color border border-surface cursor-pointer transition-colors duration-150 hover:bg-black/5 dark:hover:bg-white/10"
              @click="clearMapArea"
            >
              {{ t("contribution.mapArea") }}
              <i class="pi pi-times text-[0.6rem] text-muted-color"></i>
            </button>
            <button
              v-for="filter in activeFilters"
              :key="filterKey(filter)"
              type="button"
              class="inline-flex items-center gap-1 pl-2 pr-1.5 py-0.5 rounded-full text-[0.7rem] font-medium bg-(--p-content-hover-background) text-color border border-surface cursor-pointer transition-colors duration-150 hover:bg-black/5 dark:hover:bg-white/10"
              @click="clearActiveFilter(filter)"
            >
              {{ filterLabel(filter) }}
              <i class="pi pi-times text-[0.6rem] text-muted-color"></i>
            </button>
          </div>
        </div>

        <div v-if="rows.length > 0" class="flex flex-col">
          <div
            v-for="row in rows"
            :key="row.contribution.id"
            class="group flex items-center gap-3 px-2 py-2 cursor-pointer transition-all duration-150 hover:bg-black/5 dark:hover:bg-white/10 active:bg-black/5 dark:active:bg-white/10 active:scale-[0.98]"
            :class="{ 'contribution-row-selected': isSelectedRow(row.contribution) }"
            @mouseenter="handleContributionHover(row.contribution, row.color)"
            @mouseleave="clearContributionHover(row.contribution.id)"
            @click="handleContributionClick(row.contribution)"
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
              <div class="flex items-baseline gap-2 text-xs text-muted-color">
                <span v-if="row.subtitle" class="min-w-0 flex-1 truncate">
                  {{ row.subtitle }}
                </span>
                <span class="shrink-0 whitespace-nowrap">
                  {{ formatRelativeTime(row.contribution.updatedAt, t) }}
                </span>
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
              @click="includeOsmContributions"
            >
              {{ t("contribution.includeOsmProjects") }}
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

    <div v-if="showScrollFade" class="scroll-fade-overlay"></div>
  </div>
</template>

<script setup lang="ts">
import {
  computed,
  defineAsyncComponent,
  nextTick,
  onBeforeUnmount,
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
  isOsmIncluded,
  mapArea,
  activateLatestContributions,
  loadMoreLatestContributions,
  clearMapArea,
  includeOsmContributions,
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
import { useDetailPanel } from "@/composables/layout/useDetailPanel";
import { useFocusStore } from "@/stores/focusStore";
import { useUiStore } from "@/stores/uiStore";
import { isMobile } from "@/services/core/viewport";
import { filtersSeen } from "@/services/core/settings";

import { useScrollFade } from "@/composables/ui/useScrollFade";
import {
  navigateToProject,
  navigateToProjectBounds,
} from "@/services/navigation/projectNavigation";
import type { LatestContribution } from "@/types/index";
import { handleOverlayClickNavigation } from "@/services/overlay/clickHandler";
import { getMapOrNull } from "@/services/core/map";
import { LngLatBounds, Marker } from "maplibre-gl";

const ProjectDetailPanel = defineAsyncComponent(() => import("./ProjectDetailPanel.vue"));

const { t, te, locale } = useI18n();
const uiStore = useUiStore();
const focusStore = useFocusStore();
const { detailVisible } = useDetailPanel();
const showInlineDetail = computed(() => detailVisible.value && !isMobile.value);

const { imageErrors, handleImageError } = useImageErrors();

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
const projectCountLabel = computed(formatProjectCount);

function formatProjectCount(): string {
  const count = projectCount.value;
  if (count === null) return "";
  const formatted = new Intl.NumberFormat(locale.value).format(count);
  const key = count === 1 ? "contribution.projectCountOne" : "contribution.projectCountMany";
  return t(key, { count: formatted });
}

// Overlays use their own image; standalone projects fall back to their render thumbnail (if any).
function getThumbnailFilename(contribution: LatestContribution): string | null {
  if (contribution.type === "overlay") {
    return contribution.filename;
  }
  return contribution.renderFilename;
}

function getThumbnailIcon(contribution: LatestContribution) {
  if (
    contribution.type === "standalone" &&
    contribution.shape &&
    contribution.tags[0] === "construction"
  ) {
    return null;
  }
  return getProjectTagIcon(contribution.tags);
}

// A nameless contribution is identified by where it is: the deepest known place becomes its title
// and the rest of the breadcrumb its subtitle. Only one that is nameless and placeless falls back
// to a placeholder.
function getHeadings(contribution: LatestContribution) {
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
      icon: getThumbnailIcon(contribution),
      color: getProjectTagColor(contribution.tags),
      shape: contribution.type === "standalone" ? contribution.shape : null,
      crossorigin:
        thumbnailUrl && imageRequiresCredentials(thumbnailUrl)
          ? ("use-credentials" as const)
          : undefined,
    };
  }),
);

const filterPopover = ref<{
  toggle: (event: Event) => void;
  hide: () => void;
} | null>(null);

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

async function handleContributionClick(contribution: LatestContribution) {
  if (isMobile.value) {
    clearContributionHover();
  }

  if (contribution.type === "overlay") {
    await handleOverlayClickNavigation(contribution);
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

let hoveredContributionId: string | null = null;
let locationBeacon: Marker | null = null;

function handleContributionHover(contribution: LatestContribution, color: string): void {
  hoveredContributionId = contribution.id;
  if (contribution.type === "overlay") {
    focusStore.setHoverTarget({
      kind: "overlay",
      overlayId: contribution.id,
      projectId: contribution.projectId,
    });
  } else {
    focusStore.setHoverTarget({ kind: "project", projectId: contribution.id });
  }

  locationBeacon?.remove();
  locationBeacon = null;
  if (typeof contribution.lat !== "number" || typeof contribution.lng !== "number") return;
  const map = getMapOrNull();
  if (!map) return;

  const element = document.createElement("div");
  element.className = "explore-project-beacon";
  element.style.setProperty("--beacon-color", color);
  locationBeacon = new Marker({ element, anchor: "center" })
    .setLngLat([contribution.lng, contribution.lat])
    .addTo(map);
}

function clearContributionHover(contributionId?: string): void {
  if (contributionId && contributionId !== hoveredContributionId) return;
  hoveredContributionId = null;
  focusStore.setHoverTarget(null);
  locationBeacon?.remove();
  locationBeacon = null;
}

const loadMoreSentinel = ref<HTMLElement | null>(null);
const { scrollAreaRef, showScrollFade } = useScrollFade();

const selectedRowId = computed(() => focusStore.selectedOverlayId ?? focusStore.selectedProjectId);

function revealSelectedDetail([id, visible]: [string | null, boolean]): void {
  if (!id || !visible) return;
  scrollAreaRef.value?.scrollTo({ top: 0, behavior: "smooth" });
}

watch([selectedRowId, showInlineDetail], revealSelectedDetail, { flush: "post" });

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
  if (!root || !sentinel || isLoading.value || !hasMore.value) return;

  loadMoreObserver ??= new IntersectionObserver(handleLoadMoreIntersect, {
    root,
    rootMargin: "0px 0px 240px",
  });
  loadMoreObserver.observe(sentinel);
}

function handleLoadMoreIntersect(entries: IntersectionObserverEntry[]): void {
  if (
    !entries.some((entry) => entry.isIntersecting) ||
    isLoading.value ||
    isLoadingMore.value ||
    !hasMore.value
  ) {
    return;
  }
  void loadMoreLatestContributions();
}

watch(
  () => [loadMoreSentinel.value, hasMore.value, isLoading.value, isLoadingMore.value],
  () => {
    void nextTick().then(observeLoadMore);
  },
  { flush: "post" },
);

watch(isLoading, resetScrollForRefresh);

function readActiveTab() {
  return uiStore.activeTab;
}

function handleActiveTabChange(activeTab: typeof uiStore.activeTab): void {
  if (activeTab === "explore") {
    activateLatestContributions();
  } else {
    filterPopover.value?.hide();
    clearContributionHover();
  }
}

function teardownExplorePanel(): void {
  loadMoreObserver?.disconnect();
  clearContributionHover();
}

watch(readActiveTab, handleActiveTabChange, { immediate: true });
onMounted(observeLoadMore);
onBeforeUnmount(teardownExplorePanel);
</script>

<style scoped>
.detail-dock {
  display: grid;
  grid-template-rows: 1fr;
}

.detail-dock-inner {
  min-height: 0;
  overflow: hidden;
}

.detail-card {
  --detail-panel-background: var(--accordion-card-bg);

  overflow: hidden;
  border: 1px solid var(--p-content-border-color);
  border-radius: 12px;
  background: var(--detail-panel-background);
  box-shadow: 0 1px 4px rgb(0 0 0 / 6%);
}

.detail-dock-enter-active,
.detail-dock-leave-active {
  transition:
    grid-template-rows 0.25s ease-out,
    opacity 0.25s ease-out;
}

.detail-dock-enter-from,
.detail-dock-leave-to {
  grid-template-rows: 0fr;
  opacity: 0;
}

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

.explore-osm-switch {
  --p-toggleswitch-width: 2rem;
  --p-toggleswitch-height: 1.125rem;
  --p-toggleswitch-gap: 0.125rem;
  --p-toggleswitch-handle-size: 0.875rem;
}

:global(.explore-project-beacon) {
  width: 18px;
  height: 18px;
  border: 3px solid white;
  border-radius: 9999px;
  background: var(--beacon-color);
  box-shadow: 0 0 0 2px rgb(15 23 42 / 55%);
  pointer-events: none;
}

@media (prefers-reduced-motion: reduce) {
  .detail-dock-enter-active,
  .detail-dock-leave-active {
    transition: opacity 0.25s ease-out;
  }
}
</style>
