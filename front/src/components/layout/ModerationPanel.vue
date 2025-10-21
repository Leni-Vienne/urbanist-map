<template>
  <div class="moderation-container">
    <!-- AI : Projects Section - pure approve/reject workflow for pending items -->
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
        @click.stop="handleOverlayClickNavigation(overlay, true)"
        v-tooltip.top="'Zoom to Overlay'"
      >
        <i class="pi pi-search"></i>
      </button>
    </template>

    <template #change-actions="{ change }">
      <button
        class="action-btn approve-btn"
        @click.stop="handleApproveChange(change.id)"
        v-tooltip.top="'Approve Change'"
      >
        <i class="pi pi-check"></i>
      </button>
      <button
        class="action-btn reject-btn"
        @click.stop="handleRejectChange(change.id)"
        v-tooltip.top="'Reject Change'"
      >
        <i class="pi pi-times"></i>
      </button>
    </template>

    </ProjectAccordionPanel>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useModeration } from '@composables/overlay/useModeration'
import { useChangeRequests } from '@composables/changes/useChangeRequests'
import { useOverlayClickHandler } from '@composables/overlay/useOverlayClickHandler'
import { useToast } from '@composables/ui/useToast'
import ProjectAccordionPanel from './ProjectAccordionPanel.vue'

// AI : Use i18n for translations
const { t } = useI18n()

// AI : Use moderation composable
const {
  projects,
  changeRequests,
  approveProject,
  rejectProject,
  approveOverlay,
  rejectOverlay,
  undoLastAction,
  recentActions,
} = useModeration()

// AI : Use change requests composable
const {
  approveChangeRequests,
  rejectChangeRequests,
} = useChangeRequests()

// AI : Create isLoading ref
const isLoading = ref(false)
const toast = useToast()

// AI : Use overlay click handler composable for shared navigation logic
const { handleOverlayClickNavigation } = useOverlayClickHandler()

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

// AI : Handle change request approval with toast notifications
async function handleApproveChange(changeId: string) {
  const result = await approveChangeRequests([changeId])

  if (result?.success) {
    toast.add({
      severity: 'success',
      summary: t('moderation.changeApproved'),
      detail: t('moderation.changeApprovedDetail'),
      life: 3000
    })

    // AI : Just remove the approved change from local state, no backend refresh needed
    // The change has been applied to the database, and the UI will update naturally
  } else {
    toast.add({
      severity: 'error',
      summary: t('moderation.approvalFailed'),
      detail: t('moderation.approvalFailedDetail'),
      life: 3000
    })
  }
}

// AI : Handle change request rejection with toast notifications
async function handleRejectChange(changeId: string) {
  const result = await rejectChangeRequests([changeId])

  if (result?.success) {
    toast.add({
      severity: 'info',
      summary: t('moderation.changeRejected'),
      detail: t('moderation.changeRejectedDetail'),
      life: 3000
    })

    // AI : Just remove the rejected change from local state, no backend refresh needed
  } else {
    toast.add({
      severity: 'error',
      summary: t('moderation.rejectionFailed'),
      detail: t('moderation.rejectionFailedDetail'),
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
