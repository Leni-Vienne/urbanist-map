<template>
  <div class="pointer-events-auto w-full" @mousedown.stop @touchstart.stop>
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
        :min-length="1"
        :loading="isLoading"
        :dropdown="false"
      >
        <template #option="{ option }">
          <div class="flex items-center justify-between gap-2 w-full">
            <span class="flex-1 text-sm">
              {{ option.name
              }}<span v-if="option.nameLocal" class="text-muted-color">
                ({{ option.nameLocal }})</span
              >, {{ option.countryCode }}
            </span>
            <Badge
              v-if="option.approvedProjectCount > 0"
              :value="option.approvedProjectCount"
              severity="info"
              class="shrink-0"
            />
          </div>
        </template>
      </AutoComplete>
    </span>
  </div>
</template>

<script setup lang="ts">
import { ref } from "vue";
import { trpc } from "@/client";
import { navigateToCity } from "@/services/navigation/locationNavigation";
import { map } from "@/services/core/map";

type CitySearchResult = {
  id: number;
  name: string;
  nameLocal: string | null;
  countryCode: string;
  lat: number;
  lng: number;
  approvedProjectCount: number;
  displayName?: string;
};

// Search state
const selectedCity = ref<CitySearchResult | null>(null);
const suggestions = ref<CitySearchResult[]>([]);
const isLoading = ref(false);
let searchTimeout: ReturnType<typeof setTimeout> | null = null;

// Debounced search function (300ms) with location-based ordering
async function onSearch(event: { query: string }) {
  const query = event.query?.trim();

  // Clear previous timeout
  if (searchTimeout) {
    clearTimeout(searchTimeout);
  }

  // Require minimum 1 character to support short city names (e.g., Chinese cities)
  if (!query || query.length === 0) {
    suggestions.value = [];
    return;
  }

  // Debounce search
  searchTimeout = setTimeout(async () => {
    try {
      isLoading.value = true;

      // Get current map center for location-based ordering
      const center = map.value.getCenter();
      if (!center) {
        console.warn("Map center not available for city search");
        suggestions.value = [];
        return;
      }

      // Use location-based search to prioritize nearby cities
      // This prevents confusion like getting Paris, Texas when viewing France
      const results = await trpc.cities.searchCitiesNearLocation.query({
        lat: center.lat,
        lng: center.lng,
        search: query,
        limit: 25,
      });

      // Add display name for AutoComplete with local name if available
      suggestions.value = results.map((city) =>
        Object.assign({}, city, {
          displayName: city.nameLocal
            ? `${city.name} (${city.nameLocal}), ${city.countryCode}`
            : `${city.name}, ${city.countryCode}`,
        }),
      );
    } catch (error) {
      console.error("Error searching cities:", error);
      suggestions.value = [];
    } finally {
      isLoading.value = false;
    }
  }, 300);
}

// Handle city selection
function onSelect(event: { value: CitySearchResult }) {
  const city = event.value;
  if (city) {
    // Navigate to selected city (fly to it) - pass coordinates for cross-country navigation
    navigateToCity(city.countryCode, {
      lat: city.lat,
      lng: city.lng,
    });

    // Clear input after navigation
    selectedCity.value = null;
    suggestions.value = [];
  }
}
</script>

<style scoped>
/* Wrapper prevents map dragging when interacting with search */

/* Override PrimeVue AutoComplete styles for compact design */
:deep(.p-autocomplete) {
  width: 100%;
}

:deep(.p-autocomplete-input) {
  padding: 0.5rem 0.75rem 0.5rem 2.5rem;
  /* Extra left padding for icon */
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
