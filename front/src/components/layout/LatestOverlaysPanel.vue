<template>
  <div class="latest-overlays-panel">
    <div class="panel-content">
      <h3 class="panel-title">Latest Images</h3>
      
      <div class="flex flex-col gap-3" v-if="overlays.length > 0">
        <div 
          v-for="overlay in overlays" 
          :key="overlay.id"
          class="flex items-center gap-3 bg-white border border-surface-300 rounded-lg p-3 cursor-pointer transition-all hover:border-surface-400 hover:shadow-sm"
          @click="handleOverlayClick(overlay)"
        >
          <!-- AI : Overlay thumbnail image -->
          <div class="w-15 h-15 rounded-md overflow-hidden bg-surface-100 flex items-center justify-center flex-shrink-0">
            <img 
              :src="getOverlayImageUrl(overlay.filename)" 
              :alt="overlay.filename"
              class="w-full h-full object-cover"
              @error="handleImageError"
            />
            <!-- AI : Fallback letter if image fails -->
            <div v-if="!overlay.imageLoaded" class="text-2xl font-bold text-surface-500">
              {{ getOverlayLetter(overlay.filename) }}
            </div>
          </div>
          
          <!-- AI : Overlay info -->
          <div class="flex-1 min-w-0">
            <p class="font-semibold text-surface-900 text-sm mb-1 truncate">{{ overlay.filename || 'Untitled' }}</p>
            <div class="flex items-center gap-1.5 text-surface-600 text-xs">
              <i class="pi pi-map-marker text-surface-500"></i>
              <img 
                v-if="overlay.countryCode" 
                :src="getFlagUrl(overlay.countryCode)" 
                :alt="overlay.countryCode"
                class="w-4 h-3 rounded-sm"
                @error="hideFlagOnError"
              />
              <span class="truncate">{{ getLocationDisplay(overlay) }}</span>
            </div>
          </div>
          
          <!-- AI : Zoom button with magnifying glass -->
          <button class="bg-surface-50 border border-surface-200 rounded-md w-8 h-8 flex items-center justify-center text-surface-500 hover:bg-surface-100 hover:text-surface-600 transition-all flex-shrink-0" @click.stop="handleOverlayClick(overlay)">
            <i class="pi pi-search"></i>
            <span class="sr-only">Zoom to {{ overlay.filename }}</span>
          </button>
        </div>
      </div>
      
      <div v-else-if="!isLoading" class="flex flex-col items-center justify-center p-12 text-center text-surface-600">
        <i class="pi pi-image text-5xl text-surface-400 mb-4"></i>
        <p class="text-base mb-2">No overlays found.</p>
        <p class="text-sm">Be the first to add a construction overlay!</p>
      </div>
      
      <div v-if="isLoading" class="flex flex-col items-center justify-center p-12 text-center text-surface-600">
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
import { buildImageUrl } from '../../utils'

// AI : Reactive state
const overlays = ref<any[]>([])
const isLoading = ref(false)

// AI : Get overlay image URL using the utility function
function getOverlayImageUrl(filename: string): string {
  return buildImageUrl(filename)
}

// AI : Get first letter of overlay name for fallback
function getOverlayLetter(filename: string): string {
  return filename?.charAt(0)?.toUpperCase() || 'O'
}

// AI : Get flag URL for country
function getFlagUrl(countryCode: string): string {
  return `https://flagcdn.com/16x12/${countryCode.toLowerCase()}.png`
}

// AI : Handle image loading errors
function handleImageError(event: Event) {
  const target = event.target as HTMLImageElement
  target.style.display = 'none'
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
    console.log('Successfully navigated to overlay:', overlay.id)
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
    overlays.value = result.map(overlay => ({
      ...overlay,
      imageLoaded: true // AI : Track image loading state
    }))
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
/* AI : Minimal scoped styles - most styling is handled by Tailwind classes */
.latest-overlays-panel {
  height: 100%;
  display: flex;
  flex-direction: column;
}

.panel-content {
  flex: 1;
  overflow-y: auto;
  padding: 1.5rem;
}

.panel-title {
  margin: 0 0 1.5rem 0;
  font-size: 1.25rem;
  font-weight: 600;
  color: var(--p-surface-800);
}

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
}
</style>