<template>
  <span>
    <!-- City link (if available) -->
    <span
      v-if="cityId && cityName"
      class="app-link"
      @click.stop="handleCityClick"
      :title="$t('location.navigateToCity', { city: cityName })"
      >{{ cityName }}, {{ countryName }}</span
    >

    <!-- Fallback if no location data -->
    <span v-if="!cityName && !countryName">{{ $t("overlay.unknownLocation") }}</span>
  </span>
</template>

<script setup lang="ts">
import { navigateToCity } from "@/services/navigation/locationNavigation";
import { useToast } from "@/composables/ui/useToast";
import { useI18n } from "vue-i18n";
import { trpc } from "@/client";

interface Props {
  cityId?: number | null;
  cityName?: string | null;
  countryCode?: string | null;
  countryName?: string | null;
}

const props = defineProps<Props>();
const toast = useToast();
const { t } = useI18n();

async function handleCityClick() {
  if (!props.cityId || !props.cityName || !props.countryCode) {
    toast.add({
      severity: "warn",
      summary: t("location.missingCityInfo"),
      detail: t("location.cannotNavigateToCity"),
      life: 3000,
    });
    return;
  }

  try {
    const city = await trpc.cities.getCityById.query({
      cityId: props.cityId,
    });

    if (!city) {
      throw new Error(t("location.cannotNavigateToCity"));
    }

    await navigateToCity(props.countryCode, {
      lat: city.lat,
      lng: city.lng,
    });
  } catch (error) {
    console.error("Failed to navigate to city:", error);
    toast.add({
      severity: "error",
      summary: t("location.navigationFailed"),
      detail: error instanceof Error ? error.message : t("location.failedToNavigate"),
      life: 3000,
    });
  }
}
</script>
