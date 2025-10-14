<template>
  <div class="latest-overlays-panel">
    <div class="panel-content">
      <div
        class="flex flex-col"
        v-if="overlays.length > 0"
      >
        <!-- AI : Clean borderless cards like the prototype -->
        <div
          v-for="overlay in overlays"
          :key="overlay.id"
          class="overlay-card"
          @click="handleOverlayClick(overlay)"
        >
          <!-- AI : Overlay thumbnail image -->
          <div class="overlay-thumbnail">
            <img
              :src="getOverlayImageUrl(overlay.filename)"
              :alt="overlay.caption ?? overlay.projectName ?? t('overlay.untitled')"
              class="w-full h-full object-cover"
              @error="(event) => handleImageError(event, overlay.id)"
              @load="(event) => handleImageLoad(event, overlay.id)"
            />
            <!-- AI : Fallback letter if image fails -->
            <i
              v-if="imageErrors[overlay.id]"
              class="pi pi-image text-2xl text-surface-400"
            ></i>
          </div>

          <!-- AI : Overlay info -->
          <div class="overlay-info">
            <h2 class="overlay-name">{{ overlay.caption ?? overlay.projectName ?? t('overlay.untitled') }}</h2>
            <div class="overlay-time">{{ formatRelativeTime(overlay.updatedAt) }}</div>
            <div class="overlay-location">
              <i class="pi pi-map-marker"></i>
              <img
                v-if="overlay.countryCode"
                :src="getFlagUrl(overlay.countryCode)"
                :alt="overlay.countryCode"
                class="country-flag"
                @error="hideFlagOnError"
              />
              <span>{{ getLocationDisplay(overlay) }}</span>
            </div>
          </div>

          <!-- AI : Zoom button like the prototype -->
          <button
            class="zoom-button"
            @click.stop="handleOverlayClick(overlay)"
            :title="t('overlay.zoomTo') + ' ' + (overlay.caption || t('overlay.untitled'))"
          >
            <i class="pi pi-search"></i>
            <span class="sr-only">{{ t('overlay.zoomTo') }} {{ overlay.caption || t('overlay.untitled') }}</span>
          </button>
        </div>
      </div>

      <div
        v-else-if="!isLoading"
        class="flex flex-col items-center justify-center p-12 text-center text-surface-600"
      >
        <i class="pi pi-image text-5xl text-surface-400 mb-4"></i>
        <p class="text-base mb-2">{{ t('overlay.noOverlaysFound') }}</p>
        <p class="text-sm">{{ t('overlay.beFirstToAdd') }}</p>
      </div>

      <div
        v-if="isLoading"
        class="flex flex-col items-center justify-center p-12 text-center text-surface-600"
      >
        <i class="pi pi-spin pi-spinner text-2xl mb-4"></i>
        <p>{{ t('overlay.loadingOverlays') }}</p>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { navigateToOverlay } from '@composables/overlay/useOverlay'
import { navigateToOverlayWithCity } from '@composables/navigation/useOverlayNavigation'
import { useToast } from '@composables/ui/useToast'
import { useLatestOverlays } from '@composables/overlay/useLatestOverlays'
import { buildThumbnailUrl, formatRelativeTime } from '../../utils'
import type { LatestOverlay } from '../../types/api'

const { t } = useI18n()

// AI : Use cached composable for latest overlays
const { overlays, isLoading, fetchLatestOverlays } = useLatestOverlays()

const imageErrors = ref<Record<string, boolean>>({})
const toast = useToast()

// AI : Get overlay thumbnail URL using the utility function
// Thumbnails are much smaller (~3KB vs full image) for efficient list display
function getOverlayImageUrl(filename: string): string {
  return buildThumbnailUrl(filename)
}


// AI : Get flag URL for country
function getFlagUrl(countryCode: string): string {
  return `https://flagcdn.com/16x12/${countryCode.toLowerCase()}.png`
}

// AI : Handle image loading errors
function handleImageError(event: Event, overlayId: string) {
  imageErrors.value[overlayId] = true
  const target = event.target as HTMLImageElement
  target.style.display = 'none'
}

// AI : Handle image loading success
function handleImageLoad(event: Event, overlayId: string) {
  imageErrors.value[overlayId] = false
}

// AI : Hide flag on error
function hideFlagOnError(event: Event) {
  const target = event.target as HTMLImageElement
  target.style.display = 'none'
}

// AI : Get location display (city, country)
function getLocationDisplay(overlay: LatestOverlay): string {
  if (overlay.cityName && overlay.countryName) {
    return `${overlay.cityName}, ${overlay.countryName}`
  } else if (overlay.cityName) {
    return overlay.cityName
  } else if (overlay.countryName) {
    return overlay.countryName
  }
  return t('overlay.unknownLocation')
}

// AI : Handle overlay click - simulate clicking country marker → city marker → overlay
async function handleOverlayClick(overlay: LatestOverlay) {
  try {
    // AI : If overlay has city info, navigate via city (loads city markers and overlays first)
    if (overlay.cityId && overlay.cityName) {
      await navigateToOverlayWithCity(overlay.id, overlay.cityId, overlay.cityName, overlay.countryCode ?? undefined)
    } else {
      // AI : Fallback to direct navigation if no city info
      await navigateToOverlay(overlay.id)
    }
  } catch (error) {
    console.error('Failed to navigate to overlay:', error)
    toast.add({
      severity: 'error',
      summary: t('overlay.navigationFailed'),
      detail: error instanceof Error ? error.message : t('overlay.failedToNavigate'),
      life: 3000
    })
  }
}

// AI : fetchLatestOverlays is now provided by the composable with caching

// AI : Load initial data
onMounted(() => {
  fetchLatestOverlays()
})
</script>

<style scoped>
/* AI : Latest overlays panel with prototype-inspired design */
.latest-overlays-panel {
  height: 100%;
  display: flex;
  flex-direction: column;
}

.panel-content {
  flex: 1;
  padding: 1rem 0 1rem 1rem;
  overflow: visible;
}


/* AI : Clean borderless overlay cards like the prototype */
.overlay-card {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 1rem;
  background: transparent;
  cursor: pointer;
  transition: all 0.15s ease;
  border-radius: 0;
}

.overlay-card:hover {
  background-color: var(--p-surface-50);
}

/* AI : Overlay thumbnail */
.overlay-thumbnail {
  width: 60px;
  height: 60px;
  border-radius: 0.375rem;
  overflow: hidden;
  background-color: var(--p-surface-100);
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
}

/* AI : Overlay info section */
.overlay-info {
  flex: 1;
  min-width: 0;
}

.overlay-name {
  font-size: 0.9375rem;
  margin: 0 0 0.25rem 0;
  line-height: 1.3;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.overlay-time {
  font-size: 0.75rem;
  color: var(--p-surface-500);
  margin-bottom: 0.25rem;
}

.overlay-location {
  display: flex;
  align-items: center;
  gap: 0.375rem;
  font-size: 0.75rem;
  color: var(--p-surface-600);
  margin-bottom: 0.25rem;
}

.overlay-location i {
  color: var(--p-surface-500);
  font-size: 0.625rem;
}

.country-flag {
  width: 16px;
  height: 12px;
  border-radius: 0.125rem;
  flex-shrink: 0;
}

/* AI : Zoom button styling */
.zoom-button {
  width: 32px;
  height: 32px;
  border: 1px solid var(--p-surface-200);
  background-color: var(--p-surface-50);
  border-radius: 0.375rem;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--p-surface-500);
  cursor: pointer;
  transition: all 0.2s ease;
  flex-shrink: 0;
}

.zoom-button:hover {
  background-color: var(--p-surface-100);
  color: var(--p-surface-600);
  border-color: var(--p-surface-300);
}

.zoom-button i {
  font-size: 0.75rem;
}

/* AI : Screen reader only text */
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}


/* AI : Mobile responsive adjustments */
@media (max-width: 768px) {
  .panel-content {
    padding: 0.75rem;
  }

  .overlay-card {
    padding: 0.625rem;
    gap: 0.625rem;
  }

  .overlay-thumbnail {
    width: 50px;
    height: 50px;
  }

  .overlay-name {
    font-size: 0.8125rem;
  }
}
</style>
