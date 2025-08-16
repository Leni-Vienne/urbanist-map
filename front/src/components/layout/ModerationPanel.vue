<template>
  <div class="moderation-container">
    <!-- AI : Change Requests Section -->
    <div v-if="changeRequests.length > 0" class="change-requests-section">
      <h3>Pending Change Requests</h3>
      <div class="change-requests-list">
        <div 
          v-for="group in groupedChangeRequests" 
          :key="group.key" 
          class="change-request-group"
        >
          <div class="group-header">
            <div class="group-title">
              <h4>{{ group.entityType }} - {{ group.entityId }}</h4>
              <div class="group-actions">
                <Button
                  icon="pi pi-check"
                  @click="approveChangeGroup(group.requests)"
                  size="small"
                  label="Approve All"
                  severity="success"
                />
                <Button
                  icon="pi pi-times"
                  @click="rejectChangeGroup(group.requests)"
                  size="small"
                  label="Reject All"
                  severity="danger"
                />
              </div>
            </div>
          </div>
          <div class="changes-list">
            <div 
              v-for="change in group.requests" 
              :key="change.id"
              class="change-item"
            >
              <div class="change-content">
                <div class="change-field">
                  <strong>{{ change.fieldName }}:</strong>
                  <div class="change-values">
                    <span class="old-value">{{ formatValue(change.oldValue) }}</span>
                    <i class="pi pi-arrow-right"></i>
                    <span class="new-value">{{ formatValue(change.newValue) }}</span>
                  </div>
                  <div v-if="change.changeReason" class="change-reason">
                    <em>Reason: {{ change.changeReason }}</em>
                  </div>
                </div>
                <div class="change-actions">
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
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- AI : Projects Section -->
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

// AI : Group change requests by entity
const groupedChangeRequests = computed(() => {
  const groups = new Map<string, PendingChangeRequest[]>()
  
  changeRequests.value.forEach(request => {
    const key = `${request.entityType}:${request.entityId}`
    if (!groups.has(key)) {
      groups.set(key, [])
    }
    groups.get(key)!.push(request)
  })
  
  return Array.from(groups.entries()).map(([key, requests]) => {
    const [entityType, entityId] = key.split(':')
    return {
      key,
      entityType,
      entityId,
      requests
    }
  })
})

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

async function approveChangeGroup(requests: PendingChangeRequest[]) {
  try {
    const ids = requests.map(r => r.id)
    await approveChangeRequests(ids)
  } catch (error) {
    console.error('Failed to approve change group:', error)
  }
}

async function rejectChangeGroup(requests: PendingChangeRequest[]) {
  try {
    const ids = requests.map(r => r.id)
    await rejectChangeRequests(ids)
  } catch (error) {
    console.error('Failed to reject change group:', error)
  }
}

// AI : Format values for display
function formatValue(value: any): string {
  if (value === null || value === undefined || value === '') {
    return 'Not set'
  }
  if (typeof value === 'object') {
    return JSON.stringify(value, null, 2)
  }
  return String(value)
}
</script>

<style scoped>
/* AI : Main moderation container */
.moderation-container {
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
}

/* AI : Change requests section */
.change-requests-section {
  background: white;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  padding: 1rem;
}

.change-requests-section h3 {
  margin: 0 0 1rem 0;
  color: #374151;
  font-size: 1.125rem;
  font-weight: 600;
}

.change-request-group {
  border: 1px solid #e5e7eb;
  border-radius: 6px;
  margin-bottom: 1rem;
  overflow: hidden;
}

.group-header {
  background: #f9fafb;
  padding: 0.75rem 1rem;
  border-bottom: 1px solid #e5e7eb;
}

.group-title {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.group-header h4 {
  margin: 0;
  font-size: 0.875rem;
  font-weight: 600;
  color: #374151;
}

.group-actions {
  display: flex;
  gap: 0.5rem;
}

.changes-list {
  padding: 0;
}

.change-item {
  padding: 0.75rem 1rem;
  border-bottom: 1px solid #f3f4f6;
}

.change-item:last-child {
  border-bottom: none;
}

.change-content {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.change-field {
  flex: 1;
  min-width: 0; /* Allow text to wrap */
}

.change-field strong {
  color: #374151;
  font-size: 0.875rem;
}

.change-values {
  display: flex;
  align-items: flex-start;
  gap: 0.5rem;
  margin: 0.25rem 0;
  font-family: 'Courier New', monospace;
  font-size: 0.75rem;
  flex-wrap: wrap;
}

.old-value {
  color: #dc2626;
  background: #fef2f2;
  padding: 0.125rem 0.25rem;
  border-radius: 3px;
  word-break: break-word;
  max-width: 200px;
}

.new-value {
  color: #059669;
  background: #ecfdf5;
  padding: 0.125rem 0.25rem;
  border-radius: 3px;
  word-break: break-word;
  max-width: 200px;
}

.change-reason {
  font-size: 0.75rem;
  color: #6b7280;
  margin-top: 0.25rem;
}

.change-actions {
  display: flex;
  gap: 0.25rem;
  justify-content: flex-end;
  flex-shrink: 0;
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