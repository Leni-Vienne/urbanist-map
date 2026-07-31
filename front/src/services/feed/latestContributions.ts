import { computed, ref, watch } from "vue";
import { trpc, type RouterOutput } from "@/client";
import { loadOrNull } from "@/services/core/errorHandling";
import { useUiStore } from "@/stores/uiStore";
import { feedFilterInput } from "@/services/core/filters";
import type { LatestContribution } from "@/types/index";

type FeedCursor = RouterOutput["feed"]["getLatestContributions"]["nextCursor"];
type OsmSyncStatus = RouterOutput["feed"]["getOsmSyncStatus"];

export type ContributionSource = "all" | "community" | "osm";
export type MapArea = {
  west: number;
  south: number;
  east: number;
  north: number;
};

const PAGE_SIZE = 20;

// Latest contributions (overlays + standalone projects) from all users. Module-level singleton
// state, shared across every consumer.
const latestContributions = ref<LatestContribution[]>([]);
const cursor = ref<FeedCursor>(null);
const loading = ref(false);
const loadingMore = ref(false);
const latestProjectCount = ref<number | null>(null);
const countLoading = ref(false);

// Empty or complete selection both mean "no narrowing", so the toggles stay independent and a
// selected pair reads as selected instead of collapsing to a single All button.
export const sourceSelection = ref<Exclude<ContributionSource, "all">[]>(["community"]);
export const mapArea = ref<MapArea | null>(null);
const osmSyncStatus = ref<OsmSyncStatus | null>(null);
let hasLoadedOsmSyncStatus = false;

const osmEverSelected = ref(false);

function soleSelection<T extends string>(values: T[]): T | "all" {
  return values.length === 1 ? (values[0] ?? "all") : "all";
}

export const source = computed<ContributionSource>(() => soleSelection(sourceSelection.value));

// Identifies the query the loaded rows belong to. Comparing it against the live one tells whether
// the list is stale without keeping a copy of the filter state.
const queryKey = computed(() => JSON.stringify(buildFilterQueryInput()));
const loadedKey = ref<string | null>(null);
const loadedCountKey = ref<string | null>(null);
let requestedCountKey: string | null = null;

// Only the newest request may write to the list; earlier ones are abandoned on arrival.
let requestToken = 0;
let countRequestToken = 0;

export const contributions = computed(() => latestContributions.value);
export const isLoading = computed(() => loading.value);
export const isLoadingMore = computed(() => loadingMore.value);
export const projectCount = computed(() => latestProjectCount.value);
// The count survives a query change and is only replaced once the new one arrives, so narrowing the
// feed never collapses the row it sits on. True while the shown count does not describe the live
// query.
export const isCountStale = computed(() => loadedCountKey.value !== queryKey.value);
export const hasMore = computed(() => cursor.value !== null);
export const osmLastSyncedAt = computed(() => osmSyncStatus.value?.lastSyncedAt ?? null);
export const showOsmSyncNotice = computed(
  () => !osmEverSelected.value && osmLastSyncedAt.value !== null,
);
// True while the tab hosting this feed is the one on screen, so a filter change with the tab closed
// costs no request. Read from the shared tab state rather than the panel's own mount hooks: desktop
// and mobile render separate panel components, and swapping one for the other across the viewport
// breakpoint tears a panel down and builds another without the tab ever changing.
export const isFeedActive = computed(() => useUiStore().activeTab === "latest");

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

async function fetchPage(pageCursor: FeedCursor) {
  return loadOrNull(
    async () => trpc.feed.getLatestContributions.query(buildQueryInput(pageCursor)),
    {
      errorMessage: "Failed to load latest contributions. Please refresh the page.",
    },
  );
}

function ensureContributionCount(key: string): void {
  if (loadedCountKey.value === key || (countLoading.value && requestedCountKey === key)) return;
  void refreshContributionCount(key);
}

function invalidateContributionCount(): void {
  countRequestToken += 1;
  loadedCountKey.value = null;
  requestedCountKey = null;
  countLoading.value = false;
}

async function refreshContributionCount(key: string): Promise<void> {
  countRequestToken += 1;
  const token = countRequestToken;
  requestedCountKey = key;
  loadedCountKey.value = null;
  countLoading.value = true;
  try {
    const result = await loadOrNull(async () =>
      trpc.feed.getContributionCount.query(buildFilterQueryInput()),
    );
    if (token !== countRequestToken || !result) return;
    latestProjectCount.value = result.count;
    loadedCountKey.value = key;
  } finally {
    if (token === countRequestToken) {
      countLoading.value = false;
      requestedCountKey = null;
    }
  }
}

// Discards the current list and loads page one for the live query.
async function refreshLatestContributions(): Promise<void> {
  requestToken += 1;
  const token = requestToken;
  loadingMore.value = false;
  const key = queryKey.value;
  // Alongside the page, not after it: the count is its own query and waiting on the list only
  // widens the window where the shown count is stale.
  ensureContributionCount(key);
  loading.value = true;
  try {
    const result = await fetchPage(null);
    if (token !== requestToken || !result) return;
    latestContributions.value = result.items;
    cursor.value = result.nextCursor;
    loadedKey.value = key;
  } finally {
    if (token === requestToken) {
      loading.value = false;
    }
  }
}

export async function loadMoreLatestContributions(): Promise<void> {
  const pageCursor = cursor.value;
  if (!pageCursor || loadingMore.value) return;

  requestToken += 1;
  const token = requestToken;
  loadingMore.value = true;
  try {
    const result = await fetchPage(pageCursor);
    if (token !== requestToken || !result) return;
    latestContributions.value = [...latestContributions.value, ...result.items];
    cursor.value = result.nextCursor;
  } finally {
    if (token === requestToken) {
      loadingMore.value = false;
    }
  }
}

// Loads only when the list does not already match the live query, so re-entering the tab is free.
export function activateLatestContributions(): void {
  void loadOsmSyncStatus();
  if (loadedKey.value !== queryKey.value && !loading.value) {
    void refreshLatestContributions();
    return;
  }
  ensureContributionCount(queryKey.value);
}

// Bounding the feed to a viewport asks what is in that place, so it widens the selection to every
// source rather than answering from whichever of the two happens to be toggled on.
export function setMapArea(bounds: MapArea): void {
  sourceSelection.value = ["community", "osm"];
  if (sameMapArea(mapArea.value, bounds)) return;
  changeMapArea(bounds);
}

export function clearMapArea(): void {
  if (!mapArea.value) return;
  changeMapArea(null);
}

function changeMapArea(bounds: MapArea | null): void {
  clearLoadedContributions();
  mapArea.value = bounds;
  if (!isFeedActive.value) {
    void refreshLatestContributions();
  }
}

export function showOsmUpdates(): void {
  sourceSelection.value = ["osm"];
}

async function loadOsmSyncStatus(): Promise<void> {
  if (hasLoadedOsmSyncStatus) return;
  const result = await loadOrNull(async () => trpc.feed.getOsmSyncStatus.query());
  if (!result) return;
  osmSyncStatus.value = result;
  hasLoadedOsmSyncStatus = true;
}

function clearLoadedContributions(): void {
  requestToken += 1;
  latestContributions.value = [];
  cursor.value = null;
  loadedKey.value = null;
  loadingMore.value = false;
  invalidateContributionCount();
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

watch(sourceSelection, (selection) => {
  osmEverSelected.value ||= selection.includes("osm");
});

watch(queryKey, () => {
  if (isFeedActive.value) {
    void refreshLatestContributions();
  }
});
