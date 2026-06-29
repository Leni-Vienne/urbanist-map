import { ref, computed, onMounted, watch } from "vue";
import { useI18n } from "vue-i18n";
import { trpc } from "@/client";
import { mobileAwareFlyTo } from "@/services/map/mapNavigation";
import { useAuthStore } from "@/stores/authStore";
import { useMapStore } from "@/stores/pinia/mapStore";
import { useModerationStore } from "@/stores/pinia/moderationStore";
import { loadOrNull } from "@/services/core/errorHandling";

interface Options {
  // Invoked when the active country changes and the moderation list needs to be (re)fetched.
  onCountryDataNeeded: () => Promise<void>;
}

export function useModerationCountrySelector({ onCountryDataNeeded }: Options) {
  const { t } = useI18n();
  const authStore = useAuthStore();
  const mapStore = useMapStore();
  const moderationStore = useModerationStore();

  const countriesLoading = ref(false);

  // Single source of truth lives in mapStore. The computed lets the template
  // continue to use v-model="selectedCountryCode".
  const selectedCountryCode = computed({
    get: () => mapStore.selectedCountryCode,
    set: (code) => {
      mapStore.selectedCountryCode = code;
    },
  });

  const availableCountries = computed(() => {
    const userCountries = authStore.user?.moderatedCountries;

    // Admin (null/undefined moderatedCountries) sees all countries.
    if (userCountries === null || userCountries === undefined) {
      return moderationStore.allCountries;
    }

    if (!Array.isArray(userCountries)) {
      console.warn("moderatedCountries is not an array:", userCountries);
      return moderationStore.allCountries;
    }

    return moderationStore.allCountries.filter((country) => userCountries.includes(country.code));
  });

  const showCountrySelector = computed(() => {
    const user = authStore.user;
    if (!user) return false;
    if (user.role === "admin") return true;
    return availableCountries.value.length > 1;
  });

  function flyToCountry(code: string) {
    const country = moderationStore.allCountries.find((c) => c.code === code);
    if (country) {
      mobileAwareFlyTo([country.centerCoordinates.y, country.centerCoordinates.x], 6);
    }
  }

  // The dropdown's v-model already wrote the new value to mapStore. The watcher
  // below handles data invalidation; this handler only flies to the country.
  function handleCountryChange() {
    if (mapStore.selectedCountryCode) {
      flyToCountry(mapStore.selectedCountryCode);
    }
  }

  function getPendingCount(countryCode: string): number {
    return moderationStore.pendingCountsByCountry.get(countryCode) ?? 0;
  }

  async function refetchPendingCounts() {
    moderationStore.resetPendingCounts();
    const counts = await loadOrNull(async () => trpc.moderation.getPendingCountsByCountry.query(), {
      errorMessage: t("moderation.refreshCountsFailed"),
    });
    if (counts) {
      moderationStore.setPendingCounts(counts);
    }
  }

  // Any change to the active country (dropdown, map click, external nav) needs
  // to invalidate the moderation list and refetch.
  watch(
    () => mapStore.selectedCountryCode,
    (newCode, oldCode) => {
      if (newCode === oldCode) return;
      moderationStore.resetModerationLoaded();
      if (newCode) {
        void onCountryDataNeeded();
      }
    },
  );

  async function initCountries() {
    if (!moderationStore.countriesLoaded) {
      const countries = await loadOrNull(async () => trpc.country.getAllCountries.query(), {
        errorMessage: t("moderation.failedToLoadCountries"),
      });
      if (countries) {
        moderationStore.setAllCountries(countries);
      }
    }
    autoSelectSingleCountry();
  }

  async function initPendingCounts() {
    if (moderationStore.pendingCountsLoaded) return;
    const counts = await loadOrNull(async () => trpc.moderation.getPendingCountsByCountry.query());
    if (counts) {
      moderationStore.setPendingCounts(counts);
    }
  }

  function autoSelectSingleCountry() {
    if (mapStore.selectedCountryCode) return;
    if (authStore.user?.role === "admin") return;
    if (availableCountries.value.length !== 1) return;

    const country = availableCountries.value[0];
    if (!country) throw new Error("No country found");

    mapStore.selectedCountryCode = country.code;
    flyToCountry(country.code);
  }

  onMounted(async () => {
    countriesLoading.value = true;
    await Promise.all([initCountries(), initPendingCounts()]);
    countriesLoading.value = false;
  });

  return {
    countriesLoading,
    selectedCountryCode,
    showCountrySelector,
    availableCountries,
    handleCountryChange,
    getPendingCount,
    refetchPendingCounts,
  };
}
