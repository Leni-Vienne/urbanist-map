<template>
  <div class="latest-overlays-panel">
    <div class="panel-content">
      <h3 class="panel-title">Latest Images</h3>
      
      <div class="overlays-list" v-if="overlays.length > 0">
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
              :alt="overlay.filename"
              class="overlay-image"
              @error="handleImageError"
            />
            <!-- AI : Fallback letter if image fails -->
            <div v-if="!overlay.imageLoaded" class="overlay-letter">
              {{ getOverlayLetter(overlay.filename) }}
            </div>
          </div>
          
          <!-- AI : Overlay info -->
          <div class="overlay-info">
            <p class="overlay-name">{{ overlay.filename || 'Untitled' }}</p>
            <div class="overlay-location">
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
          
          <!-- AI : Zoom button with magnifying glass -->
          <button class="zoom-button" @click.stop="handleOverlayClick(overlay)">
            <i class="pi pi-search"></i>
            <span class="sr-only">Zoom to {{ overlay.filename }}</span>
          </button>
        </div>
      </div>
      
      <div v-else-if="!isLoading" class="empty-state">
        <i class="pi pi-image" style="font-size: 3rem; color: #6b7280; margin-bottom: 1rem;"></i>
        <p>No overlays found.</p>
        <p class="empty-subtitle">Be the first to add a construction overlay!</p>
      </div>
      
      <div v-if="isLoading" class="loading-state">
        <i class="pi pi-spin pi-spinner" style="font-size: 2rem;"></i>
        <p>Loading overlays...</p>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { trpc, RouterOutput } from '@client'
import { navigateToOverlay } from '../../composables/overlay/useOverlayActions'

// AI : Reactive state
const overlays = ref<any[]>([])
const isLoading = ref(false)

// AI : Get overlay image URL
function getOverlayImageUrl(filename: string): string {
  // AI : This should point to your overlay image storage
  return `/uploads/${filename}`
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
.latest-overlays-panel {
  height: 100%;
  display: flex;
  flex-direction: column;
}

.panel-content {
  flex: 1;
  overflow-y: auto;
  padding: 1rem;
}

.panel-title {
  margin: 0 0 1rem 0;
  font-size: 1.125rem;
  font-weight: 600;
  color: #374151;
}

.overlays-list {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.overlay-card {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.75rem;
  background: #ffffff;
  border: 1px solid #e5e7eb;
  border-radius: 0.5rem;
  cursor: pointer;
  transition: all 0.2s ease;
}

.overlay-card:hover {
  border-color: #d1d5db;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.05);
}

.overlay-thumbnail {
  position: relative;
  width: 60px;
  height: 60px;
  border-radius: 0.375rem;
  overflow: hidden;
  background-color: #f3f4f6;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.overlay-image {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.overlay-letter {
  font-size: 1.5rem;
  font-weight: 700;
  color: #6b7280;
}

.overlay-info {
  flex: 1;
  min-width: 0;
}

.overlay-name {
  margin: 0 0 0.25rem 0;
  font-weight: 600;
  color: #111827;
  font-size: 0.875rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.overlay-location {
  display: flex;
  align-items: center;
  gap: 0.375rem;
  color: #6b7280;
  font-size: 0.75rem;
}

.country-flag {
  width: 16px;
  height: 12px;
  border-radius: 1px;
}

.zoom-button {
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 0.375rem;
  width: 2rem;
  height: 2rem;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #64748b;
  cursor: pointer;
  transition: all 0.2s ease;
  flex-shrink: 0;
}

.zoom-button:hover {
  background: #f1f5f9;
  color: #475569;
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

.empty-state,
.loading-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 3rem 1rem;
  text-align: center;
  color: #6b7280;
}

.empty-subtitle {
  font-size: 0.875rem;
  margin-top: 0.5rem;
}

/* AI : Mobile responsive styles */
@media (max-width: 768px) {
  .overlay-card {
    padding: 1rem 0.75rem;
  }
  
  .overlay-thumbnail {
    width: 70px;
    height: 70px;
  }
  
  .overlay-name {
    font-size: 1rem;
  }
  
  .overlay-location {
    font-size: 0.875rem;
  }
  
  .zoom-button {
    width: 2.5rem;
    height: 2.5rem;
  }
}
</style>