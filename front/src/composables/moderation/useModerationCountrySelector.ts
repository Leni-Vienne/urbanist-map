import { ref, computed, onMounted, onScopeDispose, watch } from "vue";
import { storeToRefs } from "pinia";
import { useI18n } from "vue-i18n";
import { trpc } from "@/client";
import { mobileAwareFlyTo } from "@/services/core/mapNavigation";
import { useAuthStore } from "@/stores/authStore";
import { useModerationStore } from "@/stores/moderationStore";
import { useUiStore } from "@/stores/uiStore";
import { loadOrNull } from "@/services/core/errorHandling";
import { canModerateCountry } from "@/services/moderation/moderationCountrySync";

interface Options {
  // Invoked when the active country changes and the moderation list needs to be (re)fetched.
  onCountryDataNeeded: () => Promise<void>;
}

export function useModerationCountrySelector({ onCountryDataNeeded }: Options) {
  const { t } = useI18n();
  const authStore = useAuthStore();
  const moderationStore = useModerationStore();
  const uiStore = useUiStore();
  const sessionEpoch = authStore.getSessionEpoch();
  const userId = authStore.user?.id;
  let disposed = false;

  onScopeDispose(() => {
    disposed = true;
  });

  function isCurrentPanel(): boolean {
    return (
      !disposed &&
      userId !== undefined &&
      sessionEpoch === authStore.getSessionEpoch() &&
      userId === authStore.user?.id
    );
  }

  const countriesLoading = ref(false);

  const { selectedCountryCode } = storeToRefs(moderationStore);

  const availableCountries = computed(() =>
    moderationStore.allCountries.filter((country) => canModerateCountry(country.code)),
  );

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

  // The dropdown's v-model already wrote the new value; this handler only flies to the country.
  function handleCountryChange() {
    if (!isCurrentPanel() || uiStore.mode !== "moderation") return;
    if (moderationStore.selectedCountryCode) {
      flyToCountry(moderationStore.selectedCountryCode);
    }
  }

  function getPendingCount(countryCode: string): number {
    return moderationStore.pendingCountsByCountry.get(countryCode) ?? 0;
  }

  async function refetchPendingCounts() {
    if (!isCurrentPanel()) return;
    moderationStore.resetPendingCounts();
    const counts = await loadOrNull(async () => trpc.moderation.getPendingCountsByCountry.query(), {
      errorMessage: t("moderation.refreshCountsFailed"),
    });
    if (counts && isCurrentPanel()) {
      moderationStore.setPendingCounts(counts);
    }
  }

  watch(
    () => moderationStore.selectedCountryCode,
    (newCode) => {
      if (newCode && isCurrentPanel() && uiStore.mode === "moderation") {
        void onCountryDataNeeded();
      }
    },
  );

  async function initCountries() {
    if (!moderationStore.countriesLoaded) {
      const countries = await loadOrNull(async () => trpc.country.getAllCountries.query(), {
        errorMessage: t("moderation.failedToLoadCountries"),
      });
      // Country metadata is account-independent and can outlive this panel.
      if (countries) {
        moderationStore.setAllCountries(countries);
      }
    }
    autoSelectSingleCountry();
  }

  async function initPendingCounts() {
    if (!isCurrentPanel() || moderationStore.pendingCountsLoaded) return;
    const counts = await loadOrNull(async () => trpc.moderation.getPendingCountsByCountry.query());
    if (counts && isCurrentPanel()) {
      moderationStore.setPendingCounts(counts);
    }
  }

  function autoSelectSingleCountry() {
    if (!isCurrentPanel() || uiStore.mode !== "moderation") return;
    if (moderationStore.selectedCountryCode) return;
    if (authStore.user?.role === "admin") return;
    if (availableCountries.value.length !== 1) return;

    const country = availableCountries.value[0];
    if (!country) throw new Error("No country found");

    moderationStore.selectedCountryCode = country.code;
    flyToCountry(country.code);
  }

  async function loadCountriesAndCounts() {
    countriesLoading.value = true;
    await Promise.all([initCountries(), initPendingCounts()]);
    if (isCurrentPanel()) countriesLoading.value = false;
  }

  onMounted(() => {
    void loadCountriesAndCounts();
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
