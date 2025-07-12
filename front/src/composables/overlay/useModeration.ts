import { ref, onMounted } from 'vue'
import { trpc } from '../../client'
import type { PendingOverlay } from '../../types'

// AI : Interface for tracking recent actions for undo functionality
interface RecentAction {
  id: string
  overlayName: string
  previousStatus: 'pending' | 'approved' | 'rejected'
  newStatus: 'approved' | 'rejected'
  timestamp: Date
}

export function useModeration() {
  const overlays = ref<PendingOverlay[]>([])
  const recentActions = ref<RecentAction[]>([])

  const fetchPendingOverlays = async () => {
    try {
      const response = await trpc.moderation.getPendingSubmissions.query()
      overlays.value = response.overlays
    }
    catch (error) {
      console.error('Error fetching pending overlays:', error)
    }
  }

  const approveOverlay = async (id: string) => {
    try {
      // AI : Find overlay name for tracking
      const overlay = overlays.value.find(o => o.id === id)
      const overlayName = overlay?.name ?? 'Unknown'

      // AI : Track action for potential undo
      const action: RecentAction = {
        id,
        overlayName,
        previousStatus: 'pending',
        newStatus: 'approved',
        timestamp: new Date()
      }

      await trpc.moderation.setOverlayApprovalStatus.mutate({
        ids: [id],
        status: 'approved',
      })

      // AI : Add to recent actions and limit to last 5 actions
      recentActions.value.unshift(action)
      recentActions.value = recentActions.value.slice(0, 5)

      await fetchPendingOverlays()
    }
    catch (error) {
      console.error(`Error approving overlay ${id}:`, error)
    }
  }

  const rejectOverlay = async (id: string) => {
    try {
      // AI : Find overlay name for tracking
      const overlay = overlays.value.find(o => o.id === id)
      const overlayName = overlay?.name ?? 'Unknown'

      // AI : Track action for potential undo
      const action: RecentAction = {
        id,
        overlayName,
        previousStatus: 'pending',
        newStatus: 'rejected',
        timestamp: new Date()
      }

      await trpc.moderation.setOverlayApprovalStatus.mutate({
        ids: [id],
        status: 'rejected',
      })

      // AI : Add to recent actions and limit to last 5 actions
      recentActions.value.unshift(action)
      recentActions.value = recentActions.value.slice(0, 5)

      await fetchPendingOverlays()
    }
    catch (error) {
      console.error(`Error rejecting overlay ${id}:`, error)
    }
  }

  const undoLastAction = async () => {
    try {
      if (recentActions.value.length === 0) {
        console.warn('No recent actions to undo')
        return false
      }

      const lastAction = recentActions.value[0]

      // AI : Restore to previous status (pending)
      await trpc.moderation.setOverlayApprovalStatus.mutate({
        ids: [lastAction.id],
        status: lastAction.previousStatus,
      })

      // AI : Remove the undone action from recent actions
      recentActions.value = recentActions.value.slice(1)

      await fetchPendingOverlays()
      return true
    }
    catch (error) {
      console.error('Error undoing last action:', error)
      return false
    }
  }

  onMounted(fetchPendingOverlays)

  return {
    overlays,
    recentActions,
    approveOverlay,
    rejectOverlay,
    undoLastAction,
  }
}
