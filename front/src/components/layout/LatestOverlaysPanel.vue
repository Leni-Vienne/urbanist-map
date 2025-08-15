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
              :alt="overlay.caption || 'Overlay'"
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
            <h4 class="overlay-name">{{ overlay.caption || 'Untitled' }}</h4>
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
            :title="`Zoom to ${overlay.caption || 'overlay'}`"
          >
            <i class="pi pi-search"></i>
            <span class="sr-only">Zoom to {{ overlay.caption }}</span>
          </button>
        </div>
      </div>

      <div
        v-else-if="!isLoading"
        class="flex flex-col items-center justify-center p-12 text-center text-surface-600"
      >
        <i class="pi pi-image text-5xl text-surface-400 mb-4"></i>
        <p class="text-base mb-2">No overlays found.</p>
        <p class="text-sm">Be the first to add a construction overlay!</p>
      </div>

      <div
        v-if="isLoading"
        class="flex flex-col items-center justify-center p-12 text-center text-surface-600"
      >
        <i class="pi pi-spin pi-spinner text-2xl mb-4"></i>
        <p>Loading overlays...</p>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { trpc } from '@client'
import { navigateToOverlay } from '../../composables/overlay/useOverlayActions'
import { buildImageUrl, formatRelativeTime } from '../../utils'

// AI : Reactive state
const overlays = ref<any[]>([])
const isLoading = ref(false)
const imageErrors = ref<Record<string, boolean>>({})

// AI : Get overlay image URL using the utility function
function getOverlayImageUrl(filename: string): string {
  return buildImageUrl(filename)
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
function getLocationDisplay(overlay: any): string {
  if (overlay.cityName && overlay.countryName) {
    return `${overlay.cityName}, ${overlay.countryName}`
  } else if (overlay.cityName) {
    return overlay.cityName
  } else if (overlay.countryName) {
    return overlay.countryName
  }
  return 'Unknown Location'
}

// AI : Handle overlay click - navigate to overlay
async function handleOverlayClick(overlay: any) {
  try {
    await navigateToOverlay(overlay.id)
  } catch (error) {
    console.error('Failed to navigate to overlay:', error)
  }
}

// AI : Fetch latest overlays from API
async function fetchLatestOverlays() {
  try {
    isLoading.value = true
    const result = await trpc.overlay.getLatestOverlays.query({
      limit: 20
    })
    overlays.value = result
  } catch (error) {
    console.error('Error fetching overlays:', error)
  } finally {
    isLoading.value = false
  }
}

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

.fallback-letter {
  font-size: 1.5rem;
  font-weight: bold;
  color: var(--p-surface-500);
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
}

/* AI : Overlay info section */
.overlay-info {
  flex: 1;
  min-width: 0;
}

.overlay-name {
  font-size: 0.9375rem;
  font-weight: 700;
  color: var(--p-surface-900);
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