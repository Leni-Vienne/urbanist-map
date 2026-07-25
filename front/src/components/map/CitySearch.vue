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
        :min-length="3"
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
import { ref } from "vue";
import { useI18n } from "vue-i18n";
import { trpc } from "@/client";
import { getMap } from "@/services/core/map";
import { mobileAwareFlyTo, mobileAwareFlyToBounds } from "@/services/core/mapNavigation";
import { useMapStore } from "@/stores/mapStore";
import { LngLatBounds } from "maplibre-gl";
import { loadOrNull } from "@/services/core/errorHandling";

type LocalizedBoundaryName = {
  name: string;
  nameEn: string | null;
  names: Record<string, string> | null;
};

type BoundarySearchResult = LocalizedBoundaryName & {
  osmId: string;
  countryCode: string | null;
  adminLevel: number;
  minLng: number;
  minLat: number;
  maxLng: number;
  maxLat: number;
  city: LocalizedBoundaryName | null;
  state: LocalizedBoundaryName | null;
  country: LocalizedBoundaryName | null;
  // Derived client-side for display.
  primary?: string;
  secondary?: string;
  displayName?: string;
};

const { locale } = useI18n();
const selectedCity = ref<BoundarySearchResult | null>(null);
const suggestions = ref<BoundarySearchResult[]>([]);
const isLoading = ref(false);
let searchTimeout: ReturnType<typeof setTimeout> | null = null;
let latestSearchId = 0;

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
function buildDisplay(boundary: BoundarySearchResult): BoundarySearchResult {
  const parts: string[] = [];
  for (const level of [boundary, boundary.city, boundary.state, boundary.country]) {
    const name = localizedName(level);
    if (name && !parts.includes(name)) {
      parts.push(name);
    }
  }
  const primary = parts[0] ?? localizedName(boundary) ?? "";
  const code = boundary.countryCode ? `(${boundary.countryCode})` : "";
  const secondary = [parts.slice(1).join(", "), code].filter(Boolean).join(" ");
  const displayName = [parts.join(", "), code].filter(Boolean).join(" ");
  return Object.assign({}, boundary, { primary, secondary, displayName });
}

async function onSearch(event: { query: string }) {
  const query = event.query?.trim();

  if (searchTimeout) clearTimeout(searchTimeout);

  if (!query || query.length === 0) {
    suggestions.value = [];
    return;
  }

  searchTimeout = setTimeout(async () => {
    latestSearchId += 1;
    const searchId = latestSearchId;
    isLoading.value = true;
    try {
      const center = getMap().getCenter();
      if (!center) {
        console.warn("Map center not available for boundary search");
        suggestions.value = [];
        return;
      }

      const results = await loadOrNull(async () =>
        trpc.boundaries.searchBoundariesNearLocation.query({
          lat: center.lat,
          lng: center.lng,
          search: query,
          limit: 25,
        }),
      );

      // A slower earlier request must not overwrite the newest query's results.
      if (searchId !== latestSearchId) {
        return;
      }

      suggestions.value = results ? results.map((boundary) => buildDisplay(boundary)) : [];
    } finally {
      if (searchId === latestSearchId) {
        isLoading.value = false;
      }
    }
  }, 300);
}

function onSelect(event: { value: BoundarySearchResult }) {
  const boundary = event.value;
  if (boundary && boundary.countryCode) {
    navigateToCity(boundary.countryCode, {
      bbox: {
        minLng: boundary.minLng,
        minLat: boundary.minLat,
        maxLng: boundary.maxLng,
        maxLat: boundary.maxLat,
      },
    });
    selectedCity.value = null;
    suggestions.value = [];
  }
}

type BoundaryBbox = { minLng: number; minLat: number; maxLng: number; maxLat: number };

// Cap how far fitting a boundary's bounds can zoom in, so a tiny neighborhood doesn't slam the
// camera to street level; large boundaries (countries, states) fit well under this anyway.
const MAX_BOUNDARY_ZOOM = 16;

function navigateToCity(
  countryCode: string,
  target?: { bbox?: BoundaryBbox; coords?: { lat: number; lng: number } },
): void {
  const mapStore = useMapStore();
  mapStore.setSelectedCountryCode(countryCode);

  if (target?.bbox) {
    const { minLng, minLat, maxLng, maxLat } = target.bbox;
    const bounds = new LngLatBounds([minLng, minLat], [maxLng, maxLat]);
    mobileAwareFlyToBounds(bounds, { maxZoom: MAX_BOUNDARY_ZOOM });
  } else if (target?.coords) {
    mobileAwareFlyTo([target.coords.lat, target.coords.lng], 14);
  }
}
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
