import { ref, onMounted } from 'vue'
import { trpc } from '@client'
import type { PendingOverlay, PendingChangeRequest } from '../../types/api'
import type { ProjectForModeration } from '@types'

// AI : Interface for tracking recent actions for undo functionality
interface RecentAction {
  id: string
  itemName: string
  itemType: 'overlay' | 'project'
  previousStatus: 'pending' | 'approved' | 'rejected'
  newStatus: 'approved' | 'rejected'
  timestamp: Date
}

// AI : Result types for approval operations
type ApprovalResult = {
  success: boolean
  itemName?: string
  error?: 'not_found' | 'version_conflict' | 'unknown'
  message?: string
}

export function useModeration() {
  const overlays = ref<PendingOverlay[]>([])
  const projects = ref<ProjectForModeration[]>([])
  const changeRequests = ref<PendingChangeRequest[]>([])
  const recentActions = ref<RecentAction[]>([])

  // AI : Simple loaded flag for moderation data
  const moderationLoaded = ref(false)

  const fetchPendingSubmissions = async () => {
    try {
      // AI : Skip if already loaded
      if (moderationLoaded.value) {
        return
      }

      const response = await trpc.moderation.getPendingSubmissions.query()
      overlays.value = response.overlays
      projects.value = response.projects
      changeRequests.value = response.changeRequests ?? []
      moderationLoaded.value = true
    }
    catch (error) {
      console.error('Error fetching pending submissions:', error)
    }
  }

  const resetModerationLoaded = () => {
    moderationLoaded.value = false
  }

  // AI : Generic approval handler for any moderation item type
  const setApprovalStatus = async <T extends { id: string; name?: string; version: number }>(
    id: string, 
    status: 'approved' | 'rejected',
    itemType: 'overlay' | 'project',
    items: T[],
    apiCall: (params: { id: string; expectedVersion: number; status: 'approved' | 'rejected' }) => Promise<{ success: boolean }>,
    notFoundMessage: string,
    conflictMessage: string,
    failureMessage: string
  ): Promise<ApprovalResult> => {
    try {
      // AI : Find item by ID and validate existence
      const item = items.find(i => i.id === id)
      if (!item) {
        return {
          success: false,
          error: 'not_found',
          message: notFoundMessage
        }
      }

      const itemName = item.name ?? (itemType === 'project' ? 'Unknown Project' : 'Unknown')

      // AI : Use version-aware approval endpoint
      const result = await apiCall({
        id,
        expectedVersion: item.version,
        status,
      })

      if (!result.success) {
        // AI : Handle version conflicts - refresh data and return conflict info
        resetModerationLoaded()
        await fetchPendingSubmissions()
        return {
          success: false,
          error: 'version_conflict',
          message: conflictMessage,
          itemName
        }
      }

      // AI : Track action for potential undo
      const action: RecentAction = {
        id,
        itemName,
        itemType,
        previousStatus: 'pending',
        newStatus: status,
        timestamp: new Date()
      }

      // AI : Add to recent actions and limit to last 5 actions
      recentActions.value.unshift(action)
      recentActions.value = recentActions.value.slice(0, 5)

      resetModerationLoaded()
      await fetchPendingSubmissions()

      return {
        success: true,
        itemName
      }
    }
    catch (error) {
      console.error(`Error ${status === 'approved' ? 'approving' : 'rejecting'} ${itemType} ${id}:`, error)
      return {
        success: false,
        error: 'unknown',
        message: failureMessage
      }
    }
  }

  // AI : Helper function to set overlay approval status using the generic handler
  const setOverlayStatus = async (id: string, status: 'approved' | 'rejected'): Promise<ApprovalResult> => {
    return setApprovalStatus(
      id,
      status,
      'overlay',
      overlays.value,
      trpc.moderation.setOverlayApprovalStatusWithVersion.mutate,
      'Overlay not found',
      'This overlay was modified by another user. Please review the updated version before approving.',
      `Failed to ${status === 'approved' ? 'approve' : 'reject'} overlay`
    )
  }

  const approveOverlay = async (id: string): Promise<ApprovalResult> => {
    return await setOverlayStatus(id, 'approved')
  }

  const rejectOverlay = async (id: string): Promise<ApprovalResult> => {
    return await setOverlayStatus(id, 'rejected')
  }

  const undoLastAction = async () => {
    try {
      if (recentActions.value.length === 0) {
        console.warn('No recent actions to undo')
        return false
      }

      const lastAction = recentActions.value[0]

      // AI : Restore to previous status (pending) based on item type
      if (lastAction.itemType === 'overlay') {
        await trpc.moderation.undoOverlayApprovalStatus.mutate({
          id: lastAction.id,
          status: lastAction.previousStatus,
        })
      } else if (lastAction.itemType === 'project') {
        await trpc.moderation.undoProjectApprovalStatus.mutate({
          id: lastAction.id,
          status: lastAction.previousStatus,
        })
      }

      // AI : Remove the undone action from recent actions
      recentActions.value = recentActions.value.slice(1)

      resetModerationLoaded()
      await fetchPendingSubmissions()
      return true
    }
    catch (error) {
      console.error('Error undoing last action:', error)
      return false
    }
  }

  onMounted(fetchPendingSubmissions)

  // AI : Helper function to set project approval status using the generic handler
  const setProjectStatus = async (id: string, status: 'approved' | 'rejected'): Promise<ApprovalResult> => {
    return setApprovalStatus(
      id,
      status,
      'project',
      projects.value,
      trpc.moderation.setProjectApprovalStatusWithVersion.mutate,
      'Project not found',
      'This project was modified by another user. Please review the updated version before approving.',
      `Failed to ${status === 'approved' ? 'approve' : 'reject'} project`
    )
  }

  const approveProject = async (id: string): Promise<ApprovalResult> => {
    return setProjectStatus(id, 'approved')
  }

  const rejectProject = async (id: string): Promise<ApprovalResult> => {
    return setProjectStatus(id, 'rejected')
  }

  return {
    overlays,
    projects,
    changeRequests,
    recentActions,
    approveOverlay,
    rejectOverlay,
    approveProject,
    rejectProject,
    undoLastAction,
    resetModerationLoaded,
  }
}
