<template>
  <ProjectAccordionPanel
    :projects="filteredProjects"
    :is-loading="isLoading"
    :change-requests="pendingChangeRequests"
    :title="$t('navigation.myContributions')"
    panel-class="my-contributions-panel"
    :empty-message="projects.length > 0 && filteredProjects.length === 0 ? 'No projects match the current filter.' : 'No projects found.'"
    :empty-sub-message="projects.length > 0 && filteredProjects.length === 0 ? 'Try changing your filter settings.' : 'Create your first construction project!'"
  >
    <template #header-actions>
      <div class="filter-controls">
        <div class="field-checkbox">
          <Checkbox v-model="onlyShowPending" inputId="onlyShowPending" binary />
          <label for="onlyShowPending">Only show pending</label>
        </div>
      </div>
    </template>

    <template #empty-state>
      <i class="pi pi-folder text-5xl text-surface-400 mb-4"></i>
      <p class="text-base mb-2">
        {{ projects.length > 0 && filteredProjects.length === 0 ? 'No projects match the current filter.' : 'No projects found.' }}
      </p>
      <p class="text-sm mb-6">
        {{ projects.length > 0 && filteredProjects.length === 0 ? 'Try changing your filter settings.' : 'Create your first construction project!' }}
      </p>
      
      <!-- AI : Add overlay button when no projects exist -->
      <Button
        v-if="projects.length === 0"
        @click="handleAddOverlayClick"
        aria-label="Add Image Overlay"
        severity="secondary"
        class="add-overlay-button"
        size="large"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          style="margin-right: 0.5rem;"
        >
          <path d="M16 5h6" />
          <path d="M19 2v6" />
          <path d="M21 11.5V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7.5" />
          <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />
          <circle cx="9" cy="9" r="2" />
        </svg>
        Add Image Overlay
      </Button>
    </template>
  </ProjectAccordionPanel>
</template>

<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import Checkbox from 'primevue/checkbox'
import Button from 'primevue/button'
import { useAddOverlay } from '@composables/overlay/useAddOverlay'
import ProjectAccordionPanel from './ProjectAccordionPanel.vue'
import { useToast } from '@composables/ui/useToast'
import { useChangeRequests } from '@composables/changes/useChangeRequests'
import { useUserContributions } from '@composables/project/useUserContributions'

// AI : Use cached composable for user contributions
const { projects, isLoading, fetchUserContributions } = useUserContributions()

const onlyShowPending = ref(true)

// AI : Stores
const { handleAddOverlayButtonClick } = useAddOverlay()

function handleAddOverlayClick() {
  const result = handleAddOverlayButtonClick()
  
  if (result.success) {
    if (result.action === 'edit_mode_enabled') {
      toast.add({
        severity: 'info',
        summary: 'Switched to Edit Mode',
        detail: 'Click the button again to add an overlay',
        life: 4000
      })
    }
  } else if (result.reason === 'edit_mode_error') {
    toast.add({
      severity: 'error',
      summary: 'Mode Switch Error',
      detail: 'Failed to switch mode. Please try again.',
      life: 3000
    })
  }
}
const toast = useToast()

// AI : Change requests functionality
const { pendingChangeRequests, refreshPendingChangeRequests } = useChangeRequests()

// AI : Computed filtered projects
const filteredProjects = computed(() => {
  if (onlyShowPending.value) {
    return projects.value.filter(project => project.status === 'pending')
  }
  return projects.value
})

// AI : Load initial data
onMounted(() => {
  fetchUserContributions()
  refreshPendingChangeRequests()
})

</script>

<style scoped>
/* AI : Component-specific styles - most moved to shared component */
.filter-controls {
  display: flex;
  align-items: center;
  gap: 1rem;
}

.field-checkbox {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.field-checkbox label {
  font-size: 0.875rem;
  color: var(--p-surface-600);
  cursor: pointer;
}

/* AI : Add overlay button styling */
.add-overlay-button {
  margin-top: 1rem;
  min-width: 160px;
  padding: 0.75rem 1.5rem;
  font-weight: 600;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
}
</style>
