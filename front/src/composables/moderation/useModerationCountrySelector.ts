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
  const selectedCountryCode = ref<string | null>(moderationStore.selectedCountryCode);

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

  function loadCountryData(countryCode: string | null, shouldFly = true) {
    if (selectedCountryCode.value !== countryCode) {
      selectedCountryCode.value = countryCode;
    }

    const isDifferentCountry = moderationStore.selectedCountryCode !== countryCode;
    moderationStore.setSelectedCountryCode(countryCode);
    if (isDifferentCountry) {
      moderationStore.resetModerationLoaded();
    }

    if (countryCode) {
      mapStore.selectedCountryCode = countryCode;

      if (shouldFly) {
        const country = moderationStore.allCountries.find((c) => c.code === countryCode);
        if (country) {
          mobileAwareFlyTo([country.centerCoordinates.y, country.centerCoordinates.x], 6, {
            duration: 1.5,
          });
        }
      }
    }
  }

  async function handleCountryChange() {
    loadCountryData(selectedCountryCode.value);
    await onCountryDataNeeded();
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

  // Keep the panel in sync when the country is set externally (e.g., from a map click).
  watch(
    () => moderationStore.selectedCountryCode,
    (newCountryCode) => {
      if (newCountryCode !== selectedCountryCode.value) {
        selectedCountryCode.value = newCountryCode;
        if (newCountryCode) {
          loadCountryData(newCountryCode);
          onCountryDataNeeded();
        }
      }
    },
  );

  onMounted(async () => {
    try {
      // Restore prior country selection (from map or moderation store) before fetching, so markers
      // appear immediately when re-entering the panel.
      const initialCode =
        mapStore.selectedCountryCode ?? moderationStore.selectedCountryCode ?? null;
      if (initialCode) {
        const user = authStore.user;
        const canAccess =
          !user?.moderatedCountries || user.moderatedCountries.includes(initialCode);
        if (canAccess) {
          loadCountryData(initialCode, true);
        }
      }

      if (!moderationStore.countriesLoaded) {
        countriesLoading.value = true;
        const countries = await trpc.country.getAllCountries.query();
        moderationStore.setAllCountries(countries);
      }

      // Auto-select country if non-admin moderator has exactly one assigned country.
      // useModeration's own onMounted ran before this and saw no country, so we explicitly fetch.
      const user = authStore.user;
      const isAdmin = user?.role === "admin";
      if (!selectedCountryCode.value && !isAdmin && availableCountries.value.length === 1) {
        const country = availableCountries.value[0];
        if (!country) {
          throw new Error("No country found");
        }
        loadCountryData(country.code);
        await onCountryDataNeeded();
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
