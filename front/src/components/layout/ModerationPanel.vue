<template>
  <ProjectAccordionPanel
    :projects="projects"
    :is-loading="isLoading"
    title="Pending Projects"
    panel-class="moderation-panel"
    empty-message="All projects reviewed!"
    empty-sub-message="No pending projects to moderate."
  >
    <template #header-actions>
      <Button
        icon="pi pi-undo"
        @click="handleUndo"
        :disabled="!canUndo"
        size="small"
        label="Undo"
        v-tooltip.top="undoTooltip"
        aria-label="Undo last action"
      />
    </template>

    <template #project-actions="{ project }">
      <div v-if="project.status === 'pending'" class="project-action-buttons">
        <button
          class="action-btn approve-btn"
          @click="approveProject(project.id)"
          v-tooltip.top="'Approve Project'"
        >
          <i class="pi pi-check"></i>
        </button>
        <button
          class="action-btn reject-btn"
          @click="rejectProject(project.id)"
          v-tooltip.top="'Reject Project'"
        >
          <i class="pi pi-times"></i>
        </button>
      </div>
    </template>

    <template #overlay-actions="{ overlay }">
      <button 
        v-if="overlay.status === 'pending'"
        class="action-btn approve-btn" 
        @click="approveOverlay(overlay.id)"
        v-tooltip.top="'Approve Overlay'"
      >
        <i class="pi pi-check"></i>
      </button>
      <button 
        v-if="overlay.status === 'pending'"
        class="action-btn reject-btn" 
        @click="rejectOverlay(overlay.id)"
        v-tooltip.top="'Reject Overlay'"
      >
        <i class="pi pi-times"></i>
      </button>
      <button 
        class="action-btn" 
        @click="handleOverlayClick(overlay)"
        v-tooltip.top="'Zoom to Overlay'"
      >
        <i class="pi pi-search"></i>
      </button>
    </template>
  </ProjectAccordionPanel>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { useModeration } from '../../composables/overlay/useModeration'
import { navigateToOverlay } from '../../composables/overlay/useOverlayActions'
import Button from 'primevue/button'
import ProjectAccordionPanel from './ProjectAccordionPanel.vue'

// AI : Use moderation composable
const {
  projects,
  approveProject,
  rejectProject,
  approveOverlay,
  rejectOverlay,
  undoLastAction,
  recentActions
} = useModeration()

// AI : Create isLoading ref
const isLoading = ref(false)

// AI : Computed properties for undo functionality
const canUndo = computed(() => recentActions.value.length > 0)
const lastAction = computed(() => recentActions.value[0] || null)

// AI : Computed tooltip for undo button
const undoTooltip = computed(() => {
  if (!canUndo.value || !lastAction.value) return 'No actions to undo'
  
  const action = lastAction.value
  const actionText = action.newStatus === 'approved' ? 'approved' : 'rejected'
  const entityText = action.itemType === 'project' ? 'project' : 'overlay'
  return `Undo ${actionText} ${entityText}: ${action.itemName}`
})

// AI : Handle undo action
async function handleUndo() {
  await undoLastAction()
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
</script>

<style scoped>
/* AI : Project action buttons container */
.project-action-buttons {
  display: flex;
  gap: 0.5rem;
  flex-shrink: 0;
}

/* AI : Component-specific action button styles */
.action-btn {
  width: 32px;
  height: 32px;
  border: 1px solid #e5e7eb;
  border-radius: 6px;
  background: white;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all 0.15s ease;
  font-size: 0.875rem;
}

.action-btn:hover {
  border-color: #d1d5db;
  background-color: #f9fafb;
}

.approve-btn {
  color: #059669;
}

.approve-btn:hover {
  background-color: #ecfdf5;
  border-color: #a7f3d0;
}

.reject-btn {
  color: #dc2626;
}

.reject-btn:hover {
  background-color: #fef2f2;
  border-color: #fecaca;
}
</style>