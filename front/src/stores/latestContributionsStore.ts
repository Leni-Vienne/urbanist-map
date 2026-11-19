import { computed, onScopeDispose, onWatcherCleanup, ref, shallowRef, watch } from "vue";
import { defineStore } from "pinia";
import { trpc, type RouterInput, type RouterOutput } from "@/client";
import { loadOrNull } from "@/services/core/errorHandling";
import { useUiStore } from "@/stores/uiStore";
import { feedFilterInput } from "@/services/core/filters";
import type { LatestContribution } from "@/types/index";

type FeedCursor = RouterOutput["feed"]["getLatestContributions"]["nextCursor"];

type ContributionSource = "all" | "community";
export type MapArea = NonNullable<RouterInput["feed"]["getLatestContributions"]["mapArea"]>;

const PAGE_SIZE = 20;
const FILTER_SETTLE_MS = 300;

export const useLatestContributionsStore = defineStore("latestContributions", () => {
  const uiStore = useUiStore();

  // Public feed state is shared within this application and survives panel remounts.
  const contributions = shallowRef<LatestContribution[]>([]);
  const cursor = ref<FeedCursor>(null);
  const hasLoadError = ref(false);
  const hasLoadMoreError = ref(false);
  const hasCountError = ref(false);
  const counts = shallowRef<RouterOutput["feed"]["getContributionCount"] | null>(null);

  const isOsmIncluded = ref(false);
  const mapArea = ref<MapArea | null>(null);

  const source = computed<ContributionSource>(() => (isOsmIncluded.value ? "all" : "community"));
  const projectCount = computed(selectedProjectCount);
  const countKey = computed(countQueryKey);
  const queryKey = computed(pageQueryKey);
  const loadedKey = ref<string | null>(null);
  const loadedCountKey = ref<string | null>(null);
  const isFeedStale = computed(() => loadedKey.value !== queryKey.value);

  const pageRequest = shallowRef<{ controller: AbortController; more: boolean } | null>(null);
  let countRequest: AbortController | null = null;
  const isLoading = computed(() => pageRequest.value?.more === false);
  const isLoadingMore = computed(() => pageRequest.value?.more === true);

  const hasMore = computed(() => cursor.value !== null);
  // True while the tab hosting this feed is the one on screen, so a filter change with the tab closed
  // costs no request. Read from the shared tab state rather than the panel's own mount hooks: desktop
  // and mobile render separate panel components, and swapping one for the other across the viewport
  // breakpoint tears a panel down and builds another without the tab ever changing.
  const isFeedActive = computed(() => uiStore.activeTab === "explore");

  function selectedProjectCount(): number | null {
    if (!counts.value) return null;
    return isOsmIncluded.value ? counts.value.count : counts.value.community;
  }

  function countQueryKey(): string {
    return JSON.stringify(buildFilterQueryInput());
  }

  function pageQueryKey(): string {
    return `${source.value}|${countKey.value}`;
  }

  function buildFilterQueryInput() {
    return {
      ...(mapArea.value && { mapArea: mapArea.value }),
      ...feedFilterInput.value,
    };
  }

  function buildQueryInput(pageCursor: FeedCursor) {
    return {
      limit: PAGE_SIZE,
      source: source.value,
      ...buildFilterQueryInput(),
      ...(pageCursor && { cursor: pageCursor }),
    };
  }

  async function refreshContributionCount(): Promise<void> {
    const key = countKey.value;
    if (loadedCountKey.value === key || countRequest) return;
    hasCountError.value = false;
    const request = new AbortController();
    countRequest = request;
    try {
      const result = await loadOrNull(
        () =>
          // Out of the batch: counting is far slower than fetching a page, and the list must not wait
          // on it.
          trpc.feed.getContributionCount.query(buildFilterQueryInput(), {
            context: { skipBatch: true },
            signal: request.signal,
          }),
        { signal: request.signal },
      );
      if (countRequest !== request) return;
      if (!result) {
        hasCountError.value = true;
        return;
      }
      counts.value = result;
      loadedCountKey.value = key;
    } finally {
      if (countRequest === request) countRequest = null;
    }
  }

  function observeContributionCount(): void {
    watch([countKey, loadedCountKey], scheduleContributionCount);
    loadCount();
  }

  function loadCount(): void {
    void refreshContributionCount();
  }

  function scheduleContributionCount([key, loadedCount]: [string, string | null]): void {
    if (key === loadedCount) return;
    const timer = setTimeout(loadCount, FILTER_SETTLE_MS);
    onWatcherCleanup(cancelScheduledCount);

    function cancelScheduledCount(): void {
      clearTimeout(timer);
    }
  }

  // Loads page one unless the live query is already shown or already on its way, so a query change, a
  // tab switch and a panel activation cannot each start the same request.
  async function activateLatestContributions(): Promise<void> {
    const key = queryKey.value;
    if (loadedKey.value === key || pageRequest.value) return;
    await loadPage(null);
  }

  async function loadMoreLatestContributions(): Promise<void> {
    const pageCursor = cursor.value;
    if (!pageCursor || pageRequest.value || isFeedStale.value) return;
    await loadPage(pageCursor);
  }

  async function loadPage(pageCursor: FeedCursor): Promise<void> {
    const key = queryKey.value;
    const request = { controller: new AbortController(), more: pageCursor !== null };
    const { signal } = request.controller;
    pageRequest.value = request;
    try {
      const result = await loadOrNull(
        () => trpc.feed.getLatestContributions.query(buildQueryInput(pageCursor), { signal }),
        { signal },
      );
      if (pageRequest.value !== request) return;
      if (request.more) hasLoadMoreError.value = !result;
      else hasLoadError.value = !result;
      if (!result) return;
      // Keep the previous results until their replacement succeeds.
      contributions.value = request.more ? [...contributions.value, ...result.items] : result.items;
      cursor.value = result.nextCursor;
      loadedKey.value = key;
    } finally {
      if (pageRequest.value === request) pageRequest.value = null;
    }
  }

  function invalidateLatestContributions(): void {
    cancelPageRequest();
    cancelCountRequest();
    contributions.value = [];
    cursor.value = null;
    loadedKey.value = null;
    loadedCountKey.value = null;
    counts.value = null;
  }

  function cancelPageRequest(): void {
    pageRequest.value?.controller.abort();
    pageRequest.value = null;
    hasLoadError.value = false;
    hasLoadMoreError.value = false;
  }

  function cancelCountRequest(): void {
    countRequest?.abort();
    countRequest = null;
    hasCountError.value = false;
  }

  // Bounding the feed to a viewport asks what is in that place, so include OSM projects too.
  function setMapArea(bounds: MapArea): void {
    isOsmIncluded.value = true;
    if (sameMapArea(mapArea.value, bounds)) return;
    changeMapArea(bounds);
  }

  function clearMapArea(): void {
    if (!mapArea.value) return;
    changeMapArea(null);
  }

  // Fetch immediately after a map gesture, even with the tab closed, so the results can be ready
  // when the user opens it. Keep the previous results until the replacement succeeds.
  function changeMapArea(bounds: MapArea | null): void {
    mapArea.value = bounds;
    void activateLatestContributions();
  }

  function sameMapArea(left: MapArea | null, right: MapArea): boolean {
    if (!left) return false;
    return (
      left.west === right.west &&
      left.south === right.south &&
      left.east === right.east &&
      left.north === right.north
    );
  }

  // Cancel synchronously so active requests always belong to the live query, even after away/back.
  watch(queryKey, cancelPageRequest, { flush: "sync" });
  watch(countKey, cancelCountRequest, { flush: "sync" });

  watch([source, countKey], refreshOnQueryChange);

  function refreshOnQueryChange(
    [nextSource]: [ContributionSource, string],
    [previousSource]: [ContributionSource, string],
  ): void {
    if (nextSource !== previousSource) {
      if (isFeedActive.value) void activateLatestContributions();
      return;
    }
    // A range slider rewrites the filters on every step of a drag.
    const timer = setTimeout(() => {
      if (isFeedActive.value) void activateLatestContributions();
    }, FILTER_SETTLE_MS);
    onWatcherCleanup(() => {
      clearTimeout(timer);
    });
  }

  // Responses arriving after disposal must not repopulate the retired store.
  onScopeDispose(invalidateLatestContributions);

  return {
    contributions,
    cursor,
    isLoading,
    isLoadingMore,
    hasLoadMoreError,
    projectCount,
    hasLoadError,
    hasCountError,
    isFeedStale,
    hasMore,
    isOsmIncluded,
    mapArea,
    activateLatestContributions,
    observeContributionCount,
    loadMoreLatestContributions,
    invalidateLatestContributions,
    setMapArea,
    clearMapArea,
  };
});
