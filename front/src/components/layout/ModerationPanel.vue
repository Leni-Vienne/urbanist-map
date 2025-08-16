<template>
  <div class="moderation-container">
    <!-- AI : Projects Section with integrated change requests -->
    <ProjectAccordionPanel
      :projects="projects"
      :change-requests="changeRequests"
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
        severity="secondary"
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

    <template #change-actions="{ change }">
      <Button
        icon="pi pi-check"
        @click="approveChangeRequest(change.id)"
        size="small"
        severity="success"
        text
      />
      <Button
        icon="pi pi-times"
        @click="rejectChangeRequest(change.id)"
        size="small"
        severity="danger"
        text
      />
    </template>
    </ProjectAccordionPanel>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, onMounted } from 'vue'
import { useModeration } from '../../composables/overlay/useModeration'
import { useChangeRequests } from '../../composables/changes/useChangeRequests'
import { navigateToOverlay } from '../../composables/overlay/useOverlayActions'
import Button from 'primevue/button'
import ProjectAccordionPanel from './ProjectAccordionPanel.vue'
import type { PendingChangeRequest } from '../../types/api'

// AI : Use moderation composable
const {
  projects,
  changeRequests: moderationChangeRequests,
  approveProject,
  rejectProject,
  approveOverlay,
  rejectOverlay,
  undoLastAction,
  recentActions
} = useModeration()

// AI : Use change requests composable
const {
  approveChangeRequests,
  rejectChangeRequests,
  refreshPendingChangeRequests
} = useChangeRequests()

// AI : Get change requests from moderation (they're included in the moderation response)
const changeRequests = computed(() => moderationChangeRequests.value)

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
  } catch (error) {
    console.error('Failed to navigate to overlay:', error)
  }
}

// AI : Change request actions
async function approveChangeRequest(changeRequestId: string) {
  try {
    await approveChangeRequests([changeRequestId])
  } catch (error) {
    console.error('Failed to approve change request:', error)
  }
}

async function rejectChangeRequest(changeRequestId: string) {
  try {
    await rejectChangeRequests([changeRequestId])
  } catch (error) {
    console.error('Failed to reject change request:', error)
  }
}
</script>

<style scoped>
/* AI : Main moderation container */
.moderation-container {
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
}

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