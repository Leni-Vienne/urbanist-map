<template>
  <div
    class="pointer-events-auto w-full"
    @mousedown.stop
    @touchstart.stop
    @click.stop
    @dblclick.stop
  >
    <span class="p-input-icon-left w-full">
      <i class="pi pi-search" />
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
        :pt="{ pcInputText: { root: { dir: 'auto' } } }"
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
    </span>
  </div>
</template>

<script setup lang="ts">
import { computed, onUnmounted, ref, shallowRef } from "vue";
import { useI18n } from "vue-i18n";
import { trpc, type RouterOutput } from "@/client";
import { getMap } from "@/services/core/map";
import { mobileAwareFlyToBounds } from "@/services/core/mapNavigation";
import { useMapStore } from "@/stores/mapStore";
import { LngLatBounds } from "maplibre-gl";
import { loadOrNull } from "@/services/core/errorHandling";
import { countAlphanumeric, MIN_LOCATION_SEARCH_ALNUM } from "@shared/locationSearch";

type BoundarySearchResult = RouterOutput["boundaries"]["searchBoundariesNearLocation"][number];
type LocalizedBoundaryName = Pick<BoundarySearchResult, "name" | "nameEn" | "names">;
type BoundarySuggestion = BoundarySearchResult & {
  primary: string;
  secondary: string;
  displayName: string;
};

const { locale } = useI18n();
const selectedCity = ref<BoundarySuggestion | null>(null);
const results = shallowRef<BoundarySearchResult[]>([]);
const suggestions = computed(() => results.value.map(buildDisplay));
const isLoading = ref(false);
let searchTimeout: ReturnType<typeof setTimeout> | null = null;
let latestSearchId = 0;

onUnmounted(cancelSearch);

// Prefer the name in the current UI locale, falling back to English, then the boundary's local name.
function localizedName(level: LocalizedBoundaryName | null): string | null {
  if (!level) {
    return null;
  }
  return level.names?.[locale.value] ?? level.nameEn ?? level.name;
}

// Build "City, State, Country (CODE)" from the matched boundary and its ancestors, skipping missing
// levels and collapsing duplicate names (city-states repeat the same name across levels). `primary`
// is the matched boundary, `secondary` is the path above it shown muted in the option list.
function buildDisplay(boundary: BoundarySearchResult): BoundarySuggestion {
  const parts: string[] = [];
  for (const level of [boundary, boundary.city, boundary.state, boundary.country]) {
    const name = localizedName(level);
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
  const searchId = latestSearchId;
  if (!query || countAlphanumeric(query) < MIN_LOCATION_SEARCH_ALNUM) {
    results.value = [];
    return;
  }

  searchTimeout = setTimeout(() => void search(query, searchId), 300);
}

async function search(query: string, searchId: number): Promise<void> {
  isLoading.value = true;
  const center = getMap().getCenter();
  const matches = await loadOrNull(async () =>
    trpc.boundaries.searchBoundariesNearLocation.query({
      lat: center.lat,
      lng: center.lng,
      search: query,
      limit: 25,
    }),
  );
  if (searchId !== latestSearchId) return;
  results.value = matches ?? [];
  isLoading.value = false;
}

function cancelSearch(): void {
  latestSearchId += 1;
  if (searchTimeout) clearTimeout(searchTimeout);
  searchTimeout = null;
  isLoading.value = false;
}

function onSelect(event: { value: BoundarySuggestion }): void {
  const boundary = event.value;
  cancelSearch();
  if (boundary.countryCode) useMapStore().setSelectedCountryCode(boundary.countryCode);
  mobileAwareFlyToBounds(
    new LngLatBounds([boundary.minLng, boundary.minLat], [boundary.maxLng, boundary.maxLat]),
    { maxZoom: MAX_BOUNDARY_ZOOM },
  );
  selectedCity.value = null;
  results.value = [];
}

// Cap how far fitting a boundary's bounds can zoom in, so a tiny neighborhood doesn't slam the
// camera to street level; large boundaries (countries, states) fit well under this anyway.
const MAX_BOUNDARY_ZOOM = 16;
</script>

<style scoped>
:deep(.p-autocomplete) {
  width: 100%;
}

:deep(.p-autocomplete-input) {
  padding: 0.5rem 0.75rem 0.5rem 2.5rem;
  font-size: 0.875rem;
  border-radius: 0.375rem;
  background: var(--p-content-background);
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
  width: 100%;
  min-width: 0;
}

:deep(.p-autocomplete-panel) {
  margin-top: 0.25rem;
  border-radius: 0.375rem;
  box-shadow: 0 4px 8px rgba(0, 0, 0, 0.15);
}

/* Position search icon */
.p-input-icon-left {
  display: block;
  position: relative;
  width: 100%;
}

.p-input-icon-left > i {
  position: absolute;
  left: 0.75rem;
  top: 50%;
  transform: translateY(-50%);
  color: var(--p-text-muted-color);
  z-index: 1;
}
</style>
