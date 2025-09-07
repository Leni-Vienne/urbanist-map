import { ref, onMounted } from 'vue'
import { trpc } from '@client'
import type { PendingOverlay, PendingChangeRequest } from '../../types/api'
import type { AccordionProject } from '@types'

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
  const projects = ref<AccordionProject[]>([])
  const changeRequests = ref<PendingChangeRequest[]>([])
  const recentActions = ref<RecentAction[]>([])

  const fetchPendingSubmissions = async () => {
    try {
      const response = await trpc.moderation.getPendingSubmissions.query()
      overlays.value = response.overlays
      projects.value = response.projects
      changeRequests.value = response.changeRequests || []
    }
    catch (error) {
      console.error('Error fetching pending submissions:', error)
    }
  }

  // AI : Helper function to set overlay approval status and track action with version validation
  const setOverlayStatus = async (id: string, status: 'approved' | 'rejected'): Promise<ApprovalResult> => {
    try {
      // AI : Find overlay name and version for tracking
      const overlay = overlays.value.find(o => o.id === id)
      if (!overlay) {
        return {
          success: false,
          error: 'not_found',
          message: 'Overlay not found'
        }
      }

      const itemName = overlay.name ?? 'Unknown'

      // AI : Use version-aware approval endpoint
      const result = await trpc.moderation.setOverlayApprovalStatusWithVersion.mutate({
        id,
        expectedVersion: overlay.version,
        status,
      })

      if (!result.success) {
        // AI : Handle version conflicts - refresh data and return conflict info
        await fetchPendingSubmissions()
        return {
          success: false,
          error: 'version_conflict',
          message: 'This overlay was modified by another user. Please review the updated version before approving.',
          itemName
        }
      }

      // AI : Track action for potential undo
      const action: RecentAction = {
        id,
        itemName,
        itemType: 'overlay',
        previousStatus: 'pending',
        newStatus: status,
        timestamp: new Date()
      }

      // AI : Add to recent actions and limit to last 5 actions
      recentActions.value.unshift(action)
      recentActions.value = recentActions.value.slice(0, 5)

      await fetchPendingSubmissions()

      return {
        success: true,
        itemName
      }
    }
    catch (error) {
      console.error(`Error ${status === 'approved' ? 'approving' : 'rejecting'} overlay ${id}:`, error)
      return {
        success: false,
        error: 'unknown',
        message: `Failed to ${status === 'approved' ? 'approve' : 'reject'} overlay`
      }
    }
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

      await fetchPendingSubmissions()
      return true
    }
    catch (error) {
      console.error('Error undoing last action:', error)
      return false
    }
  }

  onMounted(fetchPendingSubmissions)

  // AI : Project approval functions with tracking and version validation
  const setProjectStatus = async (id: string, status: 'approved' | 'rejected'): Promise<ApprovalResult> => {
    try {
      // AI : Find project name and version for tracking
      const project = projects.value.find(p => p.id === id)
      if (!project) {
        return {
          success: false,
          error: 'not_found',
          message: 'Project not found'
        }
      }

      const itemName = project.name ?? 'Unknown Project'

      // AI : Use version-aware approval endpoint
      const result = await trpc.moderation.setProjectApprovalStatusWithVersion.mutate({
        id,
        expectedVersion: project.version,
        status,
      })

      if (!result.success) {
        // AI : Handle version conflicts - refresh data and return conflict info
        await fetchPendingSubmissions()
        return {
          success: false,
          error: 'version_conflict',
          message: 'This project was modified by another user. Please review the updated version before approving.',
          itemName
        }
      }

      // AI : Track action for potential undo
      const action: RecentAction = {
        id,
        itemName,
        itemType: 'project',
        previousStatus: 'pending',
        newStatus: status,
        timestamp: new Date()
      }

      // AI : Add to recent actions and limit to last 5 actions
      recentActions.value.unshift(action)
      recentActions.value = recentActions.value.slice(0, 5)

      await fetchPendingSubmissions()

      return {
        success: true,
        itemName
      }
    }
    catch (error) {
      console.error(`Error ${status === 'approved' ? 'approving' : 'rejecting'} project ${id}:`, error)
      return {
        success: false,
        error: 'unknown',
        message: `Failed to ${status === 'approved' ? 'approve' : 'reject'} project`
      }
    }
  }

  const approveProject = async (id: string): Promise<ApprovalResult> => {
    return await setProjectStatus(id, 'approved')
  }

  const rejectProject = async (id: string): Promise<ApprovalResult> => {
    return await setProjectStatus(id, 'rejected')
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
  }
}
