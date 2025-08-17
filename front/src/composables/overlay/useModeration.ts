import { ref, onMounted } from 'vue'
import { trpc } from '@client'
import type { PendingOverlay, PendingChangeRequest } from '../../types/api'

// AI : Interface for tracking recent actions for undo functionality
interface RecentAction {
  id: string
  itemName: string
  itemType: 'overlay' | 'project'
  previousStatus: 'pending' | 'approved' | 'rejected'
  newStatus: 'approved' | 'rejected'
  timestamp: Date
}

export function useModeration() {
  const overlays = ref<PendingOverlay[]>([])
  const projects = ref<any[]>([])
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

  // AI : Helper function to set overlay approval status and track action
  const setOverlayStatus = async (id: string, status: 'approved' | 'rejected') => {
    try {
      // AI : Find overlay name for tracking
      const overlay = overlays.value.find(o => o.id === id)
      const itemName = overlay?.name ?? 'Unknown'

      // AI : Track action for potential undo
      const action: RecentAction = {
        id,
        itemName,
        itemType: 'overlay',
        previousStatus: 'pending',
        newStatus: status,
        timestamp: new Date()
      }

      await trpc.moderation.setOverlayApprovalStatus.mutate({
        ids: [id],
        status,
      })

      // AI : Add to recent actions and limit to last 5 actions
      recentActions.value.unshift(action)
      recentActions.value = recentActions.value.slice(0, 5)

      await fetchPendingSubmissions()
    }
    catch (error) {
      console.error(`Error ${status === 'approved' ? 'approving' : 'rejecting'} overlay ${id}:`, error)
    }
  }

  const approveOverlay = async (id: string) => {
    await setOverlayStatus(id, 'approved')
  }

  const rejectOverlay = async (id: string) => {
    await setOverlayStatus(id, 'rejected')
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
        await trpc.moderation.setOverlayApprovalStatus.mutate({
          ids: [lastAction.id],
          status: lastAction.previousStatus,
        })
      } else if (lastAction.itemType === 'project') {
        await trpc.moderation.setProjectApprovalStatus.mutate({
          ids: [lastAction.id],
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

  // AI : Project approval functions with tracking
  const setProjectStatus = async (id: string, status: 'approved' | 'rejected') => {
    try {
      // AI : Find project name for tracking
      const project = projects.value.find(p => p.id === id)
      const itemName = project?.name ?? 'Unknown Project'

      // AI : Track action for potential undo
      const action: RecentAction = {
        id,
        itemName,
        itemType: 'project',
        previousStatus: 'pending',
        newStatus: status,
        timestamp: new Date()
      }

      await trpc.moderation.setProjectApprovalStatus.mutate({
        ids: [id],
        status,
      })

      // AI : Add to recent actions and limit to last 5 actions
      recentActions.value.unshift(action)
      recentActions.value = recentActions.value.slice(0, 5)

      await fetchPendingSubmissions()
    }
    catch (error) {
      console.error(`Error ${status === 'approved' ? 'approving' : 'rejecting'} project ${id}:`, error)
    }
  }

  const approveProject = async (id: string) => {
    await setProjectStatus(id, 'approved')
  }

  const rejectProject = async (id: string) => {
    await setProjectStatus(id, 'rejected')
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
