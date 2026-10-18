<template>
  <div class="flex h-full min-h-0 flex-1 flex-col overflow-hidden">
    <!-- Details occupy a stable half of the sidebar while the results scroll independently. -->
    <div v-if="showDesktopDetail" class="explore-detail-section border-b border-surface">
      <ProjectDetailPanel />
    </div>

    <div class="relative flex min-h-0 flex-1 flex-col">
      <!-- Controls. On desktop the filter surface opens in a popover here, so narrowing the list
             never costs a navigation away from it; on mobile there is no room for it beside the list,
             so it opens the Filter tab instead. -->
      <div class="shrink-0 bg-content-background border-b border-surface">
        <div class="px-2 py-2 flex items-center gap-2">
          <span
            v-if="projectCount !== null"
            class="px-0.5 min-w-0 truncate text-[13px] text-muted-color transition-opacity duration-150"
            :class="isCountStale ? 'opacity-50' : ''"
            aria-live="polite"
          >
            {{ projectCountLabel }}
          </span>
          <span v-else-if="isCountStale" class="text-[13px] text-muted-color" aria-hidden="true">
            …
          </span>
          <i
            v-if="isLoading || isLoadingMore"
            class="pi pi-spin pi-spinner text-[11px] text-muted-color shrink-0"
          ></i>

          <label
            for="explore-include-osm"
            class="ml-auto inline-flex shrink-0 cursor-pointer items-center gap-1.5 text-[13px] text-color"
          >
            <ToggleSwitch
              input-id="explore-include-osm"
              v-model="isOsmIncluded"
              class="explore-osm-switch"
            />
            <span>{{ t("project.osmSource") }}</span>
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
            class="inline-flex items-center gap-1 pl-2 pr-1.5 py-0.5 rounded-full text-xs font-medium bg-(--p-content-hover-background) text-color border border-surface cursor-pointer transition-colors duration-150 hover:bg-black/5 dark:hover:bg-white/10"
            @click="clearMapArea"
          >
            {{ t("contribution.mapArea") }}
            <i class="pi pi-times text-[0.6rem] text-muted-color"></i>
          </button>
          <button
            v-for="filter in activeFilters"
            :key="filterKey(filter)"
            type="button"
            class="inline-flex items-center gap-1 pl-2 pr-1.5 py-0.5 rounded-full text-xs font-medium bg-(--p-content-hover-background) text-color border border-surface cursor-pointer transition-colors duration-150 hover:bg-black/5 dark:hover:bg-white/10"
            @click="clearActiveFilter(filter)"
          >
            {{ filterLabel(filter) }}
            <i class="pi pi-times text-[0.6rem] text-muted-color"></i>
          </button>
        </div>
      </div>

      <div class="relative flex min-h-0 flex-1 flex-col">
        <Listbox
          v-if="rows.length > 0"
          ref="projectList"
          class="explore-project-list flex! min-h-0 min-w-0 flex-1 flex-col rounded-none! border-0! shadow-none!"
          :model-value="selectedRowId"
          :options="rows"
          option-label="title"
          option-value="contribution.id"
          data-key="contribution.id"
          :ariaLabel="t('contribution.projects')"
          :select-on-focus="false"
          :meta-key-selection="true"
          :auto-option-focus="true"
          :focus-on-hover="false"
          scroll-height="100%"
          :virtual-scroller-options="virtualScrollerOptions"
          :pt="{
            listContainer: { class: 'min-h-0 flex-1 overflow-hidden!' },
            hiddenFirstFocusableEl: { class: 'project-list-entry' },
            list: { class: 'w-full! min-w-0! p-0! gap-0!', 'aria-busy': isLoadingMore },
            option: { class: 'p-0! rounded-none!', 'aria-setsize': hasMore ? -1 : rows.length },
            virtualScroller: {
              root: { class: 'contribution-scroll-area h-full! overscroll-contain' },
              spacer: { class: 'explore-scroll-content' },
            },
          }"
          @change="handleRowChange"
        >
          <template #option="{ option: row }">
            <div
              class="group flex h-full min-w-0 w-full items-center gap-3 px-2 py-2 transition-colors duration-150 hover:bg-black/5 dark:hover:bg-white/10"
              :class="{
                'project-row-reference':
                  !detailVisible && row.contribution.id === lastSelectedRowId,
              }"
              @click.stop="handleRowActivate($event, row.contribution)"
              @touchend.stop
              @mouseenter="handleContributionHover(row.contribution, row.color)"
              @mouseleave="clearContributionHover(row.contribution.id)"
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
                  class="text-sm font-semibold truncate leading-tight mb-0.5"
                  :class="row.isPlaceholderTitle ? 'text-muted-color italic' : 'text-color'"
                >
                  {{ row.title }}
                </h2>
                <div class="flex items-baseline gap-2 text-[13px] text-muted-color">
                  <span v-if="row.subtitle" class="min-w-0 flex-1 truncate">
                    {{ row.subtitle }}
                  </span>
                  <span class="shrink-0 whitespace-nowrap">
                    {{ formatRelativeTime(row.contribution.updatedAt, t) }}
                  </span>
                </div>
              </div>
            </div>
          </template>
        </Listbox>
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
        <div v-if="showScrollFade" class="scroll-fade-overlay"></div>
      </div>

      <div v-if="rows.length > 0" class="shrink-0">
        <div
          v-if="hasLoadMoreError"
          class="feed-load-error flex items-center justify-between gap-2 border-t border-surface px-2 py-1 text-xs"
          role="status"
        >
          <span>{{ t("contribution.loadMoreError") }}</span>
          <Button
            :label="t('common.retry')"
            :loading="isLoadingMore"
            :disabled="isLoading || isFeedStale"
            severity="secondary"
            size="small"
            text
            @click="retryLoadMore"
          />
        </div>
        <div
          v-else-if="
            !hasMore && source === 'community' && !hasPopoverFilters && !isLoading && !isFeedStale
          "
          class="flex items-center justify-center border-t border-surface px-2 py-3"
        >
          <button
            type="button"
            class="rounded-md border-0 bg-transparent px-3 py-1.5 text-[13px] font-medium text-primary-color cursor-pointer hover:bg-black/5 hover:text-primary-hover-color dark:hover:bg-white/10"
            @click="includeOsmProjects"
          >
            {{ t("contribution.moreProjectsWithOsm") }}
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
  </div>
</template>

<script setup lang="ts">
import {
  computed,
  defineAsyncComponent,
  nextTick,
  onBeforeUnmount,
  ref,
  useTemplateRef,
  type ComponentPublicInstance,
  watch,
} from "vue";
import { useI18n } from "vue-i18n";
import Listbox, { type ListboxChangeEvent } from "primevue/listbox";
import type { VirtualScrollerLazyEvent } from "primevue/virtualscroller";
import {
  contributions,
  isLoading,
  isLoadingMore,
  hasLoadMoreError,
  isCountStale,
  isFeedStale,
  projectCount,
  hasMore,
  source,
  isOsmIncluded,
  mapArea,
  activateLatestContributions,
  loadMoreLatestContributions,
  clearMapArea,
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
import { useScrollAnchor } from "@/composables/ui/useScrollAnchor";
import {
  navigateToProject,
  navigateToProjectBounds,
} from "@/services/navigation/projectNavigation";
import type { LatestContribution } from "@/types/index";
import { handleOverlayClickNavigation } from "@/services/overlay/clickHandler";
import { getMapOrNull } from "@/services/core/map";
import { closeDetail } from "@/services/overlay/selection";
import { LngLatBounds, Marker } from "maplibre-gl";

const ProjectDetailPanel = defineAsyncComponent(() => import("./ProjectDetailPanel.vue"));

const { t, te, locale } = useI18n();
const uiStore = useUiStore();
const focusStore = useFocusStore();
const { detailVisible } = useDetailPanel();
const showDesktopDetail = computed(() => detailVisible.value && !isMobile.value);

const { imageErrors, handleImageError } = useImageErrors();

// Drives the empty-state copy: an empty list means something different when the query was narrowed.
const hasNarrowedQuery = computed(
  () => activeFilterCount.value > 0 || source.value !== "all" || mapArea.value !== null,
);

// Everything reachable only through the popover, so the button can show that something is applied.
const hasPopoverFilters = computed(() => activeFilterCount.value > 0 || mapArea.value !== null);
// Before the filter surface has ever been opened the dot is a discovery hint instead.
const showFilterDot = computed(() => hasPopoverFilters.value || !filtersSeen.value);
const hasChippedFilters = computed(() => activeFilters.value.length > 0 || mapArea.value !== null);
const projectCountLabel = computed(formatProjectCount);

function includeOsmProjects(): void {
  isOsmIncluded.value = true;
}

function formatProjectCount(): string {
  const count = projectCount.value;
  if (count === null) return "";
  const formatted = new Intl.NumberFormat(locale.value).format(count);
  const key = count === 1 ? "contribution.projectCountOne" : "contribution.projectCountMany";
  return t(key, { count: formatted });
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
  const fallback =
    contribution.type === "overlay" && contribution.kind === "map"
      ? "overlay.untitled"
      : "project.unnamed";
  return { title: t(fallback), isPlaceholder: true, subtitle: t("project.noLocation") };
}

// Resolve the thumbnail URL, crossorigin flag, headings, category icon, tag color and shape once
// per contribution, instead of recomputing them several times each in the template.
const rows = computed(() =>
  contributions.value.map((contribution) => {
    const filename = contribution.type === "overlay" ? contribution.filename : null;
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

  if (contribution.type === "overlay" && contribution.kind === "map") {
    await handleOverlayClickNavigation(contribution);
  } else {
    const projectId = contribution.type === "overlay" ? contribution.projectId : contribution.id;
    if (!projectId) return;
    if (contribution.geometryBbox) {
      const { minLat, maxLat, minLng, maxLng } = contribution.geometryBbox;
      const bounds = new LngLatBounds([minLng, minLat], [maxLng, maxLat]);
      navigateToProjectBounds(bounds, projectId);
    } else if (typeof contribution.lat === "number" && typeof contribution.lng === "number") {
      navigateToProject(contribution.lat, contribution.lng, projectId);
    }
  }
}

// The row whose detail is shown above the list, so the list still says which one the panel
// describes. An overlay selection carries its parent project id too, so match on the row's own kind.
function isSelectedRow(contribution: LatestContribution): boolean {
  if (contribution.type === "overlay" && contribution.kind === "map") {
    return contribution.id === focusStore.selectedOverlayId;
  }
  const projectId = contribution.type === "overlay" ? contribution.projectId : contribution.id;
  return projectId === focusStore.selectedProjectId;
}

let hoveredContributionId: string | null = null;
let locationBeacon: Marker | null = null;

function handleContributionHover(contribution: LatestContribution, color: string): void {
  hoveredContributionId = contribution.id;
  if (contribution.type === "overlay" && contribution.kind === "map") {
    focusStore.setHoverTarget({
      kind: "overlay",
      overlayId: contribution.id,
      projectId: contribution.projectId,
    });
  } else {
    const projectId = contribution.type === "overlay" ? contribution.projectId : contribution.id;
    focusStore.setHoverTarget(projectId ? { kind: "project", projectId } : null);
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

const projectList = useTemplateRef<ComponentPublicInstance>("projectList");
const listElement = computed(() => {
  const element: unknown = projectList.value?.$el;
  return element instanceof HTMLElement ? element : null;
});
const scrollAreaRef = computed(
  () => listElement.value?.querySelector<HTMLElement>(".contribution-scroll-area") ?? null,
);
// The spacer represents the full loaded list height, including rows outside the rendered window.
const contentRef = computed(
  () => listElement.value?.querySelector<HTMLElement>(".explore-scroll-content") ?? null,
);
const { showScrollFade } = useScrollFade(scrollAreaRef, contentRef);
const { captureRow, clearAnchor } = useScrollAnchor(scrollAreaRef);
const selectedRowId = computed(
  () => rows.value.find((row) => isSelectedRow(row.contribution))?.contribution.id ?? null,
);
const lastSelectedRowId = ref<string | null>(null);

function rememberSelectedRow(id: string | null): void {
  if (id) lastSelectedRowId.value = id;
}

watch(selectedRowId, rememberSelectedRow, { immediate: true });

const virtualScrollerOptions = computed(() => ({
  itemSize: isMobile.value ? 68 : 76,
  numToleratedItems: 5,
  lazy: true,
  onLazyLoad: loadMoreForRange,
}));

function handleRowChange(event: ListboxChangeEvent): void {
  if (event.value === null) {
    closeDetail();
    return;
  }
  const row = rows.value.find((item) => item.contribution.id === event.value);
  if (!row) return;
  handleRowActivate(event.originalEvent, row.contribution);
}

function handleRowActivate(event: Event, contribution: LatestContribution): void {
  if (!isMobile.value && !showDesktopDetail.value) {
    const target = event.target;
    const option =
      (target instanceof Element ? target.closest<HTMLElement>("[role=option]") : null) ??
      listElement.value?.querySelector<HTMLElement>("[data-p-focused=true]");
    if (option) captureRow(option);
  }
  void handleContributionClick(contribution);
}

function loadMoreForRange(range: VirtualScrollerLazyEvent): void {
  if (!hasLoadMoreError.value && range.last >= rows.value.length - 4) {
    void loadMoreLatestContributions();
  }
}

function focusProjectList(): void {
  listElement.value?.querySelector<HTMLElement>(".project-list-entry")?.focus();
}

async function retryLoadMore(): Promise<void> {
  const restoreFocus = document.activeElement?.closest(".feed-load-error") !== null;
  await loadMoreLatestContributions();
  await nextTick();
  if (
    restoreFocus &&
    !hasLoadMoreError.value &&
    uiStore.activeTab === "explore" &&
    document.activeElement === document.body
  ) {
    focusProjectList();
  }
}

function resetScrollForRefresh(loading: boolean): void {
  if (loading) {
    clearAnchor();
    lastSelectedRowId.value = null;
    scrollAreaRef.value?.scrollTo({ top: 0 });
  }
}

watch(isLoading, resetScrollForRefresh);

function anchorClosingDetail(visible: boolean): void {
  if (visible) return;
  const area = scrollAreaRef.value;
  if (!area) return;
  const top = area.getBoundingClientRect().top;
  const row = [...area.querySelectorAll<HTMLElement>("[role=option]")].find(
    (option) => option.getBoundingClientRect().bottom > top,
  );
  if (row) captureRow(row);
}

// Capture before Vue removes the panel, while the rows still have their old screen positions.
watch(showDesktopDetail, anchorClosingDetail);

function restoreListFocus(visible: boolean): void {
  if (
    !visible &&
    uiStore.activeTab === "explore" &&
    document.activeElement?.closest(".project-detail-panel")
  ) {
    // Enter through Listbox's focus entry so its internal Tab sentinels are reset as well.
    void nextTick().then(focusProjectList);
  }
}

watch(detailVisible, restoreListFocus);

function readActiveTab() {
  return uiStore.activeTab;
}

function handleActiveTabChange(activeTab: typeof uiStore.activeTab): void {
  if (activeTab === "explore") {
    activateLatestContributions();
  } else {
    clearAnchor();
    filterPopover.value?.hide();
    clearContributionHover();
  }
}

function teardownExplorePanel(): void {
  clearContributionHover();
}

watch(readActiveTab, handleActiveTabChange, { immediate: true });
onBeforeUnmount(teardownExplorePanel);
</script>

<style scoped>
.explore-detail-section {
  flex: 0 0 50%;
  min-height: 0;
  overflow: hidden;
}

:deep(.contribution-scroll-area) {
  scrollbar-width: thin;
  scrollbar-color: color-mix(in srgb, var(--p-text-muted-color) 35%, transparent) transparent;
}

:deep(.contribution-scroll-area)::-webkit-scrollbar {
  width: 0.5rem;
}

:deep(.contribution-scroll-area)::-webkit-scrollbar-track {
  background: transparent;
}

:deep(.contribution-scroll-area)::-webkit-scrollbar-thumb {
  background: color-mix(in srgb, var(--p-text-muted-color) 35%, transparent);
  border: 2px solid transparent;
  border-radius: 999px;
  background-clip: padding-box;
}

:deep(.contribution-scroll-area)::-webkit-scrollbar-thumb:hover {
  background-color: color-mix(in srgb, var(--p-text-muted-color) 60%, transparent);
}

:deep(.contribution-scroll-area)::-webkit-scrollbar-thumb:active {
  background-color: color-mix(in srgb, var(--p-text-muted-color) 75%, transparent);
}

:deep(.p-listbox-list:focus-visible .p-listbox-option.p-focus) {
  outline: 2px solid var(--p-primary-color);
  outline-offset: -2px;
}

.contribution-thumbnail {
  background-color: color-mix(in srgb, var(--thumbnail-color) 10%, transparent);
}

.explore-project-list {
  --p-listbox-option-selected-background: color-mix(
    in srgb,
    var(--p-primary-color) 10%,
    transparent
  );
  --p-listbox-option-selected-color: var(--p-text-color);
  --p-listbox-option-selected-focus-background: color-mix(
    in srgb,
    var(--p-primary-color) 15%,
    transparent
  );
  --p-listbox-option-selected-focus-color: var(--p-text-color);
}

.project-row-reference {
  background-color: var(--p-listbox-option-selected-background);
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
</style>
