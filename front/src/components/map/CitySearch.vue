<template>
  <div
    class="city-search relative w-full"
    @mousedown.stop
    @touchstart.stop
    @click.stop
    @dblclick.stop
  >
    <i class="pi pi-search pointer-events-none" aria-hidden="true" />
    <AutoComplete
      v-model="selectedCity"
      :suggestions="suggestions"
      :placeholder="$t('search.cities')"
      option-label="displayName"
      @complete="onSearch"
      @item-select="onSelect"
      class="w-full"
      :min-length="0"
      :loading="isLoading"
      :dropdown="false"
      name="city-search"
      :pt="{ pcInputText: { root: { dir: 'auto', 'aria-label': $t('search.cities') } } }"
    >
      <template #option="{ option }">
        <div class="flex flex-col min-w-0 w-full leading-tight">
          <span class="text-sm truncate">{{ option.primary }}</span>
          <span v-if="option.secondary" class="text-xs text-muted-color truncate">
            {{ option.secondary }}
          </span>
        </div>
      </template>
    </AutoComplete>
    <div class="absolute inset-y-px right-px z-1 w-(--locate-button-width)">
      <LocateControl />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onUnmounted, ref, shallowRef, watch } from "vue";
import { useI18n } from "vue-i18n";
import { trpc, type RouterOutput } from "@/client";
import { getMapOrNull } from "@/services/core/map";
import { mobileAwareFlyToBounds } from "@/services/core/mapNavigation";
import { useModerationStore } from "@/stores/moderationStore";
import { LngLatBounds } from "maplibre-gl";
import { loadOrNull } from "@/services/core/errorHandling";
import { countAlphanumeric, MIN_LOCATION_SEARCH_ALNUM } from "@shared/locationSearch";
import { localizedBoundaryName } from "@shared/types/boundary";
import LocateControl from "@/components/map/LocateControl.vue";

type BoundarySearchResult = RouterOutput["boundaries"]["searchBoundariesNearLocation"][number];
type BoundarySuggestion = BoundarySearchResult & {
  primary: string;
  secondary: string;
  displayName: string;
};

const { locale } = useI18n();
const selectedCity = ref<BoundarySuggestion | null>(null);
const results = shallowRef<BoundarySearchResult[]>([]);
const suggestions = computed(() => results.value.map(buildDisplay));
const searchController = shallowRef<AbortController | null>(null);
const isLoading = computed(() => searchController.value !== null);
let searchTimeout: ReturnType<typeof setTimeout> | null = null;

onUnmounted(cancelSearch);
// AutoComplete debounces its complete event; retire results as soon as its input changes.
watch(selectedCity, cancelSearch, { flush: "sync" });

// Build "City, State, Country (CODE)" from the matched boundary and its ancestors, skipping missing
// levels and collapsing duplicate names (city-states repeat the same name across levels). `primary`
// is the matched boundary, `secondary` is the path above it shown muted in the option list.
function buildDisplay(boundary: BoundarySearchResult): BoundarySuggestion {
  const parts: string[] = [];
  for (const level of [boundary, boundary.city, boundary.state, boundary.country]) {
    const name = localizedBoundaryName(level, locale.value);
    if (name && !parts.includes(name)) {
      parts.push(name);
    }
  }
  const primary = parts[0] ?? boundary.name;
  const code = boundary.countryCode ? `(${boundary.countryCode})` : "";
  const secondary = [parts.slice(1).join(", "), code].filter(Boolean).join(" ");
  const displayName = [parts.join(", "), code].filter(Boolean).join(" ");
  return { ...boundary, primary, secondary, displayName };
}

function onSearch(event: { query: string }): void {
  const query = event.query?.trim();
  cancelSearch();
  if (!query || countAlphanumeric(query) < MIN_LOCATION_SEARCH_ALNUM) {
    return;
  }

  searchTimeout = setTimeout(() => void search(query), 300);
}

async function search(query: string): Promise<void> {
  searchTimeout = null;
  const map = getMapOrNull();
  if (!map) return;
  const controller = new AbortController();
  searchController.value = controller;
  const center = map.getCenter();
  const matches = await loadOrNull(
    () =>
      trpc.boundaries.searchBoundariesNearLocation.query(
        {
          lat: center.lat,
          lng: center.lng,
          search: query,
          limit: 25,
        },
        { signal: controller.signal },
      ),
    { signal: controller.signal },
  );
  if (searchController.value !== controller) return;
  results.value = getMapOrNull() === map ? (matches ?? []) : [];
  searchController.value = null;
}

function cancelSearch(): void {
  searchController.value?.abort();
  searchController.value = null;
  if (searchTimeout) clearTimeout(searchTimeout);
  searchTimeout = null;
  results.value = [];
}

function onSelect(event: { value: BoundarySuggestion }): void {
  const boundary = event.value;
  cancelSearch();
  if (boundary.countryCode) useModerationStore().selectedCountryCode = boundary.countryCode;
  mobileAwareFlyToBounds(
    new LngLatBounds([boundary.minLng, boundary.minLat], [boundary.maxLng, boundary.maxLat]),
    { maxZoom: MAX_BOUNDARY_ZOOM },
  );
  selectedCity.value = null;
}

// Cap how far fitting a boundary's bounds can zoom in, so a tiny neighborhood doesn't slam the
// camera to street level; large boundaries (countries, states) fit well under this anyway.
const MAX_BOUNDARY_ZOOM = 16;
</script>

<style scoped>
.city-search {
  --locate-button-width: 2.75rem;
}

:deep(.p-autocomplete-input) {
  padding: 0.5rem calc(var(--locate-button-width) + 0.5rem) 0.5rem 2rem;
  font-size: 0.875rem;
  border-radius: 0.375rem;
  background: var(--p-content-background);
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
  width: 100%;
  min-width: 0;
}

:deep(.p-autocomplete:has(.p-autocomplete-loader) .p-autocomplete-input) {
  padding-right: calc(var(--locate-button-width) + 2rem);
}

:deep(.p-autocomplete-loader) {
  inset-inline-end: calc(var(--locate-button-width) + 0.5rem);
  pointer-events: none;
}

.city-search > i {
  position: absolute;
  left: 0.75rem;
  top: 50%;
  transform: translateY(-50%);
  color: var(--p-text-muted-color);
  z-index: 1;
}
</style>
