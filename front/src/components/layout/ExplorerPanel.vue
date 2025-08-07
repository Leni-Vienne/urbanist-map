<template>
  <div class="explorer-panel">
    <div class="explorer-content">
      <!-- AI : City filter section -->
      <div class="filter-section" v-if="selectedCity">
        <div class="filter-header">
          <h4>AI : {{ currentView === 'projects' ? 'Projects' : 'Overlays' }} in {{ selectedCity.name }}</h4>
          <Button
            icon="pi pi-times"
            class="p-button-text p-button-sm"
            @click="clearCityFilter"
            v-tooltip.top="'Show all overlays'"
          />
        </div>
        
        <!-- AI : View toggle for city content -->
        <div class="view-toggle">
          <Button
            :class="['p-button-sm', currentView === 'overlays' ? 'p-button-outlined' : '']"
            @click="currentView = 'overlays'"
            label="Overlays"
          />
          <Button
            :class="['p-button-sm', currentView === 'projects' ? 'p-button-outlined' : '']" 
            @click="currentView = 'projects'"
            label="Projects"
          />
        </div>
      </div>
      
      <!-- AI : Section header -->
      <div class="section-header">
        <h4>{{ getSectionTitle() }}</h4>
      </div>
      
      <!-- AI : Content list (overlays or projects) -->
      <div class="content-list" v-if="currentContent.length > 0">
        <!-- AI : Overlay items -->
        <div 
          v-for="item in currentContent" 
          :key="item.id"
          class="content-item"
          @click="handleItemClick(item)"
        >
          <div class="content-info">
            <div class="content-name">
              {{ currentView === 'projects' ? item.name : (item.projectName ?? 'Unnamed Project') }}
            </div>
            <div class="content-details">
              <span class="content-city" v-if="!selectedCity">
                {{ currentView === 'projects' ? item.city?.name : item.cityName ?? 'Unknown City' }}
              </span>
              <span class="content-date">{{ formatDate(item.createdAt) }}</span>
              <span v-if="currentView === 'projects' && item.overlayCount > 0" class="overlay-count">
                {{ item.overlayCount }} overlay{{ item.overlayCount !== 1 ? 's' : '' }}
              </span>
            </div>
            <div class="content-description" v-if="currentView === 'projects' && item.description">
              {{ item.description }}
            </div>
            <div class="content-caption" v-else-if="currentView === 'overlays' && item.caption">
              {{ item.caption }}
            </div>
          </div>
          <div class="content-actions">
            <i :class="currentView === 'projects' ? 'pi pi-building' : 'pi pi-map-marker'" />
          </div>
        </div>
      </div>
      
      <div v-else-if="!isLoading" class="empty-state">
        <i :class="currentView === 'projects' ? 'pi pi-building' : 'pi pi-map'" style="font-size: 3rem; color: #6b7280; margin-bottom: 1rem;"></i>
        <p>AI : No {{ currentView }} found{{ selectedCity ? ' in this city' : '' }}.</p>
        <p class="empty-subtitle">AI : {{ currentView === 'projects' ? 'Be the first to add a construction project!' : 'Be the first to add a construction overlay!' }}</p>
      </div>
      
      <div v-if="isLoading" class="loading-state">
        <i class="pi pi-spin pi-spinner" style="font-size: 2rem;"></i>
        <p>AI : Loading overlays...</p>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, watch, computed } from 'vue'
import { trpc, RouterOutput } from '@client';
import { navigateToOverlay } from '../../composables/overlay/useOverlayActions'
import Button from 'primevue/button'

const props = defineProps<{
  isModerator?: boolean
  currentPanelType?: string
}>()

defineEmits<{
  close: []
  togglePanel: []
}>()

// AI : Reactive state
const overlays = ref<any[]>([])
const projects = ref<any[]>([])
const isLoading = ref(false)
const selectedCity = ref<any>(null)
const currentView = ref<'overlays' | 'projects'>('overlays')

// AI : Computed current content based on view
const currentContent = computed(() => {
  return currentView.value === 'projects' ? projects.value : overlays.value
})

// AI : Format date for display
function formatDate(dateString: string) {
  const date = new Date(dateString)
  return date.toLocaleDateString('en-US', { 
    month: 'short', 
    day: 'numeric',
    year: date.getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined
  })
}

// AI : Get section title
function getSectionTitle() {
  if (selectedCity.value) {
    return currentView.value === 'projects' ? 'Projects' : 'Overlays'
  }
  return 'Latest Overlays Worldwide'
}

// AI : Handle item click (overlay or project)
async function handleItemClick(item: any) {
  if (currentView.value === 'projects') {
    // AI : When clicking on a project, just navigate to it (don't change the view)
    console.log('Navigate to project:', item.id)
    // TODO: Could implement project navigation logic here (focus map on project area, show project details, etc.)
    // But don't change from projects view to projects view - that's redundant
  } else {
    // AI : For overlay click: 1) Navigate to overlay on map, 2) Show projects in that city
    
    // First, navigate to the overlay on the map
    try {
      await navigateToOverlay(item.id)
      console.log('Successfully navigated to overlay:', item.id)
    } catch (error) {
      console.error('Failed to navigate to overlay:', error)
    }
    
    // AI : Don't automatically switch views - just navigate to the overlay
    // User can manually switch to projects if they want to explore the city
    console.log('Navigated to overlay, staying in overlay view')
  }
}

// AI : Note: Refresh functionality removed from explorer - only available in moderation panel

// AI : Clear city filter
function clearCityFilter() {
  selectedCity.value = null
  currentView.value = 'overlays'
  fetchLatestOverlays()
}

// AI : Fetch latest overlays from API
async function fetchLatestOverlays() {
  try {
    isLoading.value = true
    const result = await trpc.overlay.getLatestOverlays.query({
      limit: 20,
      cityId: selectedCity.value?.id
    })
    overlays.value = result
  } catch (error) {
    console.error('Error fetching overlays:', error)
  } finally {
    isLoading.value = false
  }
}

// AI : Fetch projects by city
async function fetchProjectsByCity() {
  if (!selectedCity.value) return
  
  try {
    isLoading.value = true
    const result = await trpc.project.getProjectsByCity.query({
      cityId: selectedCity.value.id,
      limit: 20
    })
    projects.value = result
  } catch (error) {
    console.error('Error fetching projects by city:', error)
  } finally {
    isLoading.value = false
  }
}

// AI : Watch for city changes and view changes
watch(selectedCity, () => {
  if (currentView.value === 'projects') {
    fetchProjectsByCity()
  } else {
    fetchLatestOverlays()
  }
})

watch(currentView, () => {
  if (currentView.value === 'projects' && selectedCity.value) {
    fetchProjectsByCity()
  } else {
    fetchLatestOverlays()
  }
})

// AI : Expose function to set city (can be called from parent components)
function setSelectedCity(city: any) {
  selectedCity.value = city
}

// AI : Expose setSelectedCity for external use
defineExpose({ setSelectedCity })

// AI : Load initial data
onMounted(() => {
  fetchLatestOverlays()
})
</script>

<style scoped>
.explorer-panel {
  height: 100%;
  display: flex;
  flex-direction: column;
  background-color: #ffffff;
}

.explorer-content {
  flex: 1;
  overflow-y: auto;
  padding: 0;
}

.filter-section {
  padding: 1rem;
  background-color: #f9fafb;
  border-bottom: 1px solid #e5e7eb;
}

.filter-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.filter-header h4 {
  margin: 0;
  font-size: 1rem;
  font-weight: 600;
  color: #374151;
}

.section-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 1rem;
  border-bottom: 1px solid #f3f4f6;
}

.section-header h4 {
  margin: 0;
  font-size: 1rem;
  font-weight: 600;
  color: #374151;
}

.view-toggle {
  display: flex;
  gap: 0.5rem;
  margin-top: 0.75rem;
}

.content-list {
  padding: 0;
}

.content-item {
  padding: 1rem;
  border-bottom: 1px solid #f3f4f6;
  cursor: pointer;
  transition: background-color 0.2s ease;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.content-item:hover {
  background-color: #f9fafb;
}

.content-item:last-child {
  border-bottom: none;
}

.content-info {
  flex: 1;
  min-width: 0;
}

.content-name {
  font-size: 1rem;
  font-weight: 600;
  color: #111827;
  margin-bottom: 0.25rem;
  line-height: 1.4;
}

.content-details {
  display: flex;
  gap: 0.75rem;
  margin-bottom: 0.25rem;
  font-size: 0.875rem;
  flex-wrap: wrap;
}

.content-city {
  color: #6366f1;
  font-weight: 500;
}

.content-date {
  color: #6b7280;
}

.overlay-count {
  color: #059669;
  font-weight: 500;
}

.content-description,
.content-caption {
  font-size: 0.875rem;
  color: #6b7280;
  line-height: 1.4;
  margin-top: 0.25rem;
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}

.content-actions {
  flex-shrink: 0;
  color: #9ca3af;
  font-size: 1.25rem;
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
  .content-item {
    padding: 1.25rem 1rem;
  }
  
  .content-name {
    font-size: 1.125rem;
  }
  
  .content-details {
    font-size: 1rem;
  }
  
  .content-actions {
    font-size: 1.5rem;
  }
}
</style>