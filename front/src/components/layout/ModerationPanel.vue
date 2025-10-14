<template>
  <div class="moderation-container">
    <!-- AI : Projects Section - pure approve/reject workflow for pending items -->
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
        severity="secondary"
        v-tooltip.top="undoTooltip"
        aria-label="Undo last action"
      />
    </template>

    <template #project-actions="{ project }">
      <div v-if="project.status === 'pending'" class="project-action-buttons">
        <button
          class="action-btn approve-btn"
          @click="handleApproveProject(project.id)"
          v-tooltip.top="'Approve Project'"
        >
          <i class="pi pi-check"></i>
        </button>
        <button
          class="action-btn reject-btn"
          @click="handleRejectProject(project.id)"
          v-tooltip.top="'Reject Project'"
        >
          <i class="pi pi-times"></i>
        </button>
      </div>
    </template>

    <template #overlay-actions="{ overlay, project }">
      <button 
        v-if="overlay.status === 'pending' && project.status === 'approved'"
        class="action-btn approve-btn" 
        @click.stop="handleApproveOverlay(overlay.id)"
        v-tooltip.top="'Approve Overlay'"
      >
        <i class="pi pi-check"></i>
      </button>
      <button 
        v-if="overlay.status === 'pending' && project.status === 'approved'"
        class="action-btn reject-btn" 
        @click.stop="handleRejectOverlay(overlay.id)"
        v-tooltip.top="'Reject Overlay'"
      >
        <i class="pi pi-times"></i>
      </button>
      <button 
        v-if="overlay.status === 'pending' && project.status !== 'approved'"
        class="action-btn disabled-btn"
        disabled
        v-tooltip.top="'Approve project first to moderate overlays'"
      >
        <i class="pi pi-lock"></i>
      </button>
      <button 
        class="action-btn" 
        @click.stop="handleOverlayClick(overlay)"
        v-tooltip.top="'Zoom to Overlay'"
      >
        <i class="pi pi-search"></i>
      </button>
    </template>

    </ProjectAccordionPanel>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { useModeration } from '@composables/overlay/useModeration'
import { navigateToOverlay } from '@composables/overlay/useOverlay'
import { useToast } from '@composables/ui/useToast'
import Button from 'primevue/button'
import ProjectAccordionPanel from './ProjectAccordionPanel.vue'
import type { OverlayForModeration } from '@types'
import { switchTileLayer, isTileLayerType, type TileLayerType } from '@composables/map/useTileLayers'

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
const toast = useToast()

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

// AI : Handle project approval with toast notifications
async function handleApproveProject(id: string) {
  const result = await approveProject(id)
  
  if (result.success) {
    toast.add({
      severity: 'success',
      summary: 'Project Approved',
      detail: `"${result.itemName}" has been approved`,
      life: 3000
    })
  } else {
    const severity = result.error === 'version_conflict' ? 'warn' : 'error'
    const summary = result.error === 'version_conflict' ? 'Project Updated' : 'Approval Failed'
    
    toast.add({
      severity,
      summary,
      detail: result.message,
      life: result.error === 'version_conflict' ? 5000 : 3000
    })
  }
}

// AI : Handle project rejection with toast notifications  
async function handleRejectProject(id: string) {
  const result = await rejectProject(id)
  
  if (result.success) {
    toast.add({
      severity: 'info',
      summary: 'Project Rejected',
      detail: `"${result.itemName}" has been rejected`,
      life: 3000
    })
  } else {
    const severity = result.error === 'version_conflict' ? 'warn' : 'error'
    const summary = result.error === 'version_conflict' ? 'Project Updated' : 'Rejection Failed'
    
    toast.add({
      severity,
      summary,
      detail: result.message,
      life: result.error === 'version_conflict' ? 5000 : 3000
    })
  }
}

// AI : Handle overlay approval with toast notifications
async function handleApproveOverlay(id: string) {
  const result = await approveOverlay(id)
  
  if (result.success) {
    toast.add({
      severity: 'success',
      summary: 'Overlay Approved',
      detail: `"${result.itemName}" has been approved`,
      life: 3000
    })
  } else {
    const severity = result.error === 'version_conflict' ? 'warn' : 'error'
    const summary = result.error === 'version_conflict' ? 'Overlay Updated' : 'Approval Failed'
    
    toast.add({
      severity,
      summary,
      detail: result.message,
      life: result.error === 'version_conflict' ? 5000 : 3000
    })
  }
}

// AI : Handle overlay rejection with toast notifications
async function handleRejectOverlay(id: string) {
  const result = await rejectOverlay(id)
  
  if (result.success) {
    toast.add({
      severity: 'info',
      summary: 'Overlay Rejected', 
      detail: `"${result.itemName}" has been rejected`,
      life: 3000
    })
  } else {
    const severity = result.error === 'version_conflict' ? 'warn' : 'error'
    const summary = result.error === 'version_conflict' ? 'Overlay Updated' : 'Rejection Failed'
    
    toast.add({
      severity,
      summary,
      detail: result.message,
      life: result.error === 'version_conflict' ? 5000 : 3000
    })
  }
}

// AI : Handle overlay click - switch tile layer and navigate to overlay
async function handleOverlayClick(overlay: OverlayForModeration) {
  try {
    // AI : Switch tile layer based on overlay's country if available
    if (overlay.countryCode) {
      // AI : Use country code directly if it's a valid tile layer, otherwise default to esri
      const tileLayerType = isTileLayerType(overlay.countryCode) ? overlay.countryCode : 'esri'
      switchTileLayer(tileLayerType as TileLayerType)
    }

    await navigateToOverlay(overlay.id)
  } catch (error) {
    console.error('Failed to navigate to overlay:', error)
    toast.add({
      severity: 'error',
      summary: 'Navigation Failed',
      detail: error instanceof Error ? error.message : 'Failed to navigate to overlay',
      life: 3000
    })
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

.disabled-btn {
  color: #9ca3af;
  cursor: not-allowed;
  opacity: 0.6;
}

.disabled-btn:hover {
  background-color: white;
  border-color: #e5e7eb;
}
</style>
