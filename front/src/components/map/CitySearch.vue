<template>
  <div class="city-search-wrapper" @mousedown.stop @touchstart.stop>
    <span class="p-input-icon-left w-full">
      <i class="pi pi-search" />
      <AutoComplete
        v-model="selectedCity"
        :suggestions="suggestions"
        :placeholder="$t('search.cities')"
        option-label="displayName"
        @complete="onSearch"
        @item-select="onSelect"
        class="city-search w-full"
        :min-length="1"
        :loading="isLoading"
        :dropdown="false"
      >
        <template #option="{ option }">
          <div class="search-result">
            <span class="city-name">
              {{ option.name
              }}<span v-if="option.nameLocal" class="city-name-local">
                ({{ option.nameLocal }})</span
              >, {{ option.countryCode }}
            </span>
            <Badge
              v-if="option.approvedProjectCount > 0"
              :value="option.approvedProjectCount"
              severity="info"
              class="project-count"
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
import { useToast } from "@/composables/ui/useToast";
import { useI18n } from "vue-i18n";
import { map } from "@/services/core/map";

const toast = useToast();
const { t } = useI18n();

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

// AI : Search state
const selectedCity = ref<CitySearchResult | null>(null);
const suggestions = ref<CitySearchResult[]>([]);
const isLoading = ref(false);
let searchTimeout: ReturnType<typeof setTimeout> | null = null;

// AI : Debounced search function (300ms) with location-based ordering
async function onSearch(event: { query: string }) {
  const query = event.query?.trim();

  // AI : Clear previous timeout
  if (searchTimeout) {
    clearTimeout(searchTimeout);
  }

  // AI : Require minimum 1 character to support short city names (e.g., Chinese cities)
  if (!query || query.length < 1) {
    suggestions.value = [];
    return;
  }

  // AI : Debounce search
  searchTimeout = setTimeout(async () => {
    try {
      isLoading.value = true;

      // AI : Get current map center for location-based ordering
      const center = map.value?.getCenter();
      if (!center) {
        console.warn("Map center not available for city search");
        suggestions.value = [];
        return;
      }

      // AI : Use location-based search to prioritize nearby cities
      // AI : This prevents confusion like getting Paris, Texas when viewing France
      const results = await trpc.cities.searchCitiesNearLocation.query({
        lat: center.lat,
        lng: center.lng,
        search: query,
        limit: 25,
      });

      // AI : Add display name for AutoComplete with local name if available
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

// AI : Handle city selection
function onSelect(event: { value: CitySearchResult }) {
  const city = event.value;
  if (city) {
    // AI : Navigate to selected city (fly to it) - pass coordinates for cross-country navigation
    navigateToCity(city.id, city.name, city.countryCode, { lat: city.lat, lng: city.lng });

    // AI : Show toast if city has no contributions yet
    if (city.approvedProjectCount === 0) {
      toast.add({
        severity: "info",
        summary: t("search.noCityContributions"),
        detail: t("search.noCityContributionsDetail", { cityName: city.name }),
        life: 5000,
      });
    }

    // AI : Clear input after navigation
    selectedCity.value = null;
    suggestions.value = [];
  }
}
</script>

<style scoped>
/* AI : Wrapper prevents map dragging when interacting with search */
.city-search-wrapper {
  pointer-events: auto;
  width: 100%;
}

@media (max-width: 768px) {
  .city-search-wrapper {
    /* Remove mobile specific overrides as parent controls layout now */
  }
}

.city-search {
  width: 100%;
}

.search-result {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  width: 100%;
}

.city-name {
  flex: 1;
  font-size: 0.875rem;
}

.city-name-local {
  color: var(--p-text-muted-color);
}

.project-count {
  flex-shrink: 0;
}

/* AI : Override PrimeVue AutoComplete styles for compact design */
:deep(.p-autocomplete) {
  width: 100%;
}

:deep(.p-autocomplete-input) {
  padding: 0.5rem 0.75rem 0.5rem 2.5rem;
  /* AI : Extra left padding for icon */
  font-size: 0.875rem;
  border-radius: 0.375rem;
  background: white;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
  width: 100%;
  /* Ensure input takes full width */
  min-width: 0;
  /* Allow shrinking */
}

:deep(.p-autocomplete-panel) {
  margin-top: 0.25rem;
  border-radius: 0.375rem;
  box-shadow: 0 4px 8px rgba(0, 0, 0, 0.15);
}

/* AI : Position search icon */
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
