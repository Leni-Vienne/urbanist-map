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
const queryKey = computed(() =>
  JSON.stringify({
    source: source.value,
    mapArea: mapArea.value,
    ...feedFilterInput.value,
  }),
);
const loadedKey = ref<string | null>(null);

// Only the newest request may write to the list; earlier ones are abandoned on arrival.
let requestToken = 0;

export const contributions = computed(() => latestContributions.value);
export const isLoading = computed(() => loading.value);
export const isLoadingMore = computed(() => loadingMore.value);
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

function buildQueryInput(pageCursor: FeedCursor) {
  return {
    limit: PAGE_SIZE,
    source: source.value,
    ...(mapArea.value && { mapArea: mapArea.value }),
    ...feedFilterInput.value,
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

// Discards the current list and loads page one for the live query.
async function refreshLatestContributions(): Promise<void> {
  requestToken += 1;
  const token = requestToken;
  loadingMore.value = false;
  const key = queryKey.value;
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
  }
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
