import { ref, computed, onMounted, watch } from "vue";
import { useI18n } from "vue-i18n";
import { trpc } from "@/client";
import { mobileAwareFlyTo } from "@/services/map/mapNavigation";
import { useToast } from "@/composables/ui/useToast";
import { useAuthStore } from "@/stores/authStore";
import { useMapStore } from "@/stores/pinia/mapStore";
import { useModerationStore } from "@/stores/pinia/moderationStore";

interface Options {
  // Invoked when the active country changes and the moderation list needs to be (re)fetched.
  onCountryDataNeeded: () => Promise<void>;
}

export function useModerationCountrySelector({ onCountryDataNeeded }: Options) {
  const { t } = useI18n();
  const toast = useToast();
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
      mobileAwareFlyTo([country.centerCoordinates.y, country.centerCoordinates.x], 6, {
        duration: 1.5,
      });
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
    try {
      moderationStore.resetPendingCounts();
      const counts = await trpc.moderation.getPendingCountsByCountry.query();
      moderationStore.setPendingCounts(counts);
    } catch (error) {
      console.error("Failed to refetch pending counts:", error);
      toast.add({
        severity: "warn",
        summary: t("moderation.refreshCountsFailed"),
        detail: error instanceof Error ? error.message : undefined,
        life: 4000,
      });
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

  onMounted(async () => {
    try {
      if (!moderationStore.countriesLoaded) {
        countriesLoading.value = true;
        const countries = await trpc.country.getAllCountries.query();
        moderationStore.setAllCountries(countries);
      }

      // Auto-select for non-admin moderators with exactly one assigned country.
      // The watcher above will pick this up and trigger the fetch.
      const user = authStore.user;
      const isAdmin = user?.role === "admin";
      if (!mapStore.selectedCountryCode && !isAdmin && availableCountries.value.length === 1) {
        const country = availableCountries.value[0];
        if (!country) {
          throw new Error("No country found");
        }
        mapStore.selectedCountryCode = country.code;
        flyToCountry(country.code);
      }

      if (!moderationStore.pendingCountsLoaded) {
        try {
          const counts = await trpc.moderation.getPendingCountsByCountry.query();
          moderationStore.setPendingCounts(counts);
        } catch (error) {
          console.error("Failed to load pending counts:", error);
        }
      }
    } catch (error) {
      console.error("Failed to load countries:", error);
      toast.add({
        severity: "error",
        summary: t("common.error"),
        detail: t("moderation.failedToLoadCountries"),
        life: 3000,
      });
    } finally {
      countriesLoading.value = false;
    }
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
