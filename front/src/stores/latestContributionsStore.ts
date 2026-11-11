import { computed, onScopeDispose, ref, shallowRef, watch } from "vue";
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

export const useLatestContributionsStore = defineStore("latestContributions", () => {
  const uiStore = useUiStore();

  // Public feed state is shared within this application and survives panel remounts.
  const contributions = shallowRef<LatestContribution[]>([]);
  const cursor = ref<FeedCursor>(null);
  const hasLoadError = ref(false);
  const hasLoadMoreError = ref(false);
  const projectCount = ref<number | null>(null);

  const isOsmIncluded = ref(false);
  const mapArea = ref<MapArea | null>(null);

  const source = computed<ContributionSource>(() => (isOsmIncluded.value ? "all" : "community"));

  // Identifies the query the loaded rows belong to. Comparing it against the live one tells whether
  // the list is stale without keeping a copy of the filter state.
  const queryKey = computed(() => JSON.stringify(buildFilterQueryInput()));
  const loadedKey = ref<string | null>(null);
  const loadedCountKey = ref<string | null>(null);
  const isFeedStale = computed(() => loadedKey.value !== queryKey.value);

  const pageRequest = shallowRef<{ controller: AbortController; more: boolean } | null>(null);
  let countRequest: AbortController | null = null;
  const isLoading = computed(() => pageRequest.value?.more === false);
  const isLoadingMore = computed(() => pageRequest.value?.more === true);

  // The count survives a query change and is only replaced once the new one arrives, so narrowing the
  // feed never collapses the row it sits on. True while the shown count does not describe the live
  // query.
  const isCountStale = computed(() => loadedCountKey.value !== queryKey.value);
  const hasMore = computed(() => cursor.value !== null);
  // True while the tab hosting this feed is the one on screen, so a filter change with the tab closed
  // costs no request. Read from the shared tab state rather than the panel's own mount hooks: desktop
  // and mobile render separate panel components, and swapping one for the other across the viewport
  // breakpoint tears a panel down and builds another without the tab ever changing.
  const isFeedActive = computed(() => uiStore.activeTab === "explore");

  function buildFilterQueryInput() {
    return {
      source: source.value,
      ...(mapArea.value && { mapArea: mapArea.value }),
      ...feedFilterInput.value,
    };
  }

  function buildQueryInput(pageCursor: FeedCursor) {
    return {
      limit: PAGE_SIZE,
      ...buildFilterQueryInput(),
      ...(pageCursor && { cursor: pageCursor }),
    };
  }

  async function refreshContributionCount(key: string): Promise<void> {
    if (loadedCountKey.value === key || countRequest) return;
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
      if (countRequest !== request || !result) return;
      projectCount.value = result.count;
      loadedCountKey.value = key;
    } finally {
      if (countRequest === request) countRequest = null;
    }
  }

  // Loads page one unless the live query is already shown or already on its way, so a query change, a
  // tab switch and a panel activation cannot each start the same request.
  async function activateLatestContributions(): Promise<void> {
    const key = queryKey.value;
    // The count is independent: retry it even if this query's rows are already loaded.
    void refreshContributionCount(key);
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
    cancelPendingRequests();
    contributions.value = [];
    cursor.value = null;
    loadedKey.value = null;
    loadedCountKey.value = null;
  }

  function cancelPendingRequests(): void {
    pageRequest.value?.controller.abort();
    countRequest?.abort();
    pageRequest.value = null;
    countRequest = null;
    hasLoadError.value = false;
    hasLoadMoreError.value = false;
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

  // A range slider rewrites the query on every step of a drag, and each intermediate query would
  // otherwise cost a page fetch plus an unbatched count query whose answers are thrown away on
  // arrival. Waiting for the query to settle sends one pair.
  const FILTER_SETTLE_MS = 300;

  // Cancel synchronously so active requests always belong to the live query, even after away/back.
  watch(queryKey, cancelPendingRequests, { flush: "sync" });

  // Pinia owns this watcher. Changing the query or disposing the store cancels its timer.
  watch(queryKey, (_key, _previous, onCleanup) => {
    const timer = setTimeout(() => {
      if (isFeedActive.value) void activateLatestContributions();
    }, FILTER_SETTLE_MS);
    onCleanup(() => {
      clearTimeout(timer);
    });
  });

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
    isCountStale,
    isFeedStale,
    hasMore,
    isOsmIncluded,
    mapArea,
    activateLatestContributions,
    loadMoreLatestContributions,
    invalidateLatestContributions,
    setMapArea,
    clearMapArea,
  };
});
