<template>
  <span class="clickable-location">
    <!-- AI : City link (if available) -->
    <span
      v-if="cityId && cityName"
      class="app-link"
      @click.stop="handleCityClick"
      :title="$t('location.navigateToCity', { city: cityName })"
    >{{ cityName }}, {{ countryName }}</span>

    <!-- AI : Fallback if no location data -->
    <span v-if="!cityName && !countryName">{{ $t('overlay.unknownLocation') }}</span>
  </span>
</template>

<script setup lang="ts">

import { navigateToCity } from '@composables/navigation/useLocationNavigation'
import { useToast } from '@composables/ui/useToast'
import { useI18n } from 'vue-i18n'

// AI : Props interface for location data
interface Props {
  cityId?: string | null
  cityName?: string | null
  countryCode?: string | null
  countryName?: string | null
}

const props = defineProps<Props>()
const toast = useToast()
const { t } = useI18n()

// AI : Handle city click - navigate to the city on the map
async function handleCityClick() {
  if (!props.cityId || !props.cityName || !props.countryCode) {
    toast.add({
      severity: 'warn',
      summary: t('location.missingCityInfo'),
      detail: t('location.cannotNavigateToCity'),
      life: 3000
    })
    return
  }

  try {
    await navigateToCity(props.cityId, props.cityName, props.countryCode)
  } catch (error) {
    console.error('Failed to navigate to city:', error)
    toast.add({
      severity: 'error',
      summary: t('location.navigationFailed'),
      detail: error instanceof Error ? error.message : t('location.failedToNavigate'),
      life: 3000
    })
  }
}

</script>

<style scoped>
.clickable-location {
  display: inline;
}
</style>
