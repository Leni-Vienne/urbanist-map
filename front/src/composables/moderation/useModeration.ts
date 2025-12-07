import { computed, onMounted, toRef } from 'vue'
import { trpc } from '@/client'
import { withErrorHandling } from '@/composables/core/useErrorHandling'
import { useModerationStore } from '@/stores/pinia/moderationStore'
import { useOverlayStore } from '@/stores/pinia/overlayStore'
import { useAuthStore } from '@/stores/authStore'
import { updateMarkerTooltip } from '@/composables/overlay/useOverlayMarkers';
import { removeOverlayFromMap } from '@/composables/overlay/useOverlayRemoval';
import { updateOverlayMarkersColors } from '@/composables/map/useMarkers'
import { useI18n } from '@/composables/useI18n'

// AI : Result types for approval operations
type ApprovalResult = {
  success: boolean
  itemName?: string
  error?: 'not_found' | 'version_conflict' | 'unknown'
  message?: string
}

export function useModeration() {
  const moderationStore = useModerationStore()
  const { t } = useI18n()

  const overlays = computed(() => moderationStore.overlays)
  const projects = computed(() => moderationStore.projects)
  const changeRequests = computed(() => moderationStore.changeRequests)
  const recentActions = computed(() => moderationStore.recentActions)

  async function fetchPendingSubmissions() {
    if (moderationStore.moderationLoaded) {
      return
    }

    moderationStore.setModerationLoading(true)
    try {
      // AI : Pass selected country code for country-scoped moderation
      const response = await withErrorHandling(
        async () => trpc.moderation.getPendingSubmissions.query({
          countryCode: moderationStore.selectedCountryCode ?? undefined
        }),
        { errorMessage: 'Failed to load pending submissions. Please refresh the page.' }
      )

      if (response) {
        moderationStore.setModerationData({
          overlays: response.overlays,
          projects: response.projects,
          changeRequests: response.changeRequests ?? []
        })
      }
    } catch (error) {
      // AI : If error is because no country is selected, don't show error toast (UI will prompt user to select)
      if (error instanceof Error && error.message.includes('must select a country')) {
        console.log('Waiting for country selection before loading moderation data')
      } else {
        throw error // Re-throw other errors to be handled by withErrorHandling
      }
    } finally {
      moderationStore.setModerationLoading(false)
    }
  }

  function resetModerationLoaded() {
    moderationStore.resetModerationLoaded()
  }

  // AI : Generic approval handler for any moderation item type
  async function setApprovalStatus<T extends { id: string; name?: string; version: number }>(
    id: string,
    status: 'approved' | 'rejected',
    itemType: 'overlay' | 'project',
    items: T[],
    apiCall: (params: { id: string; expectedVersion: number; status: 'approved' | 'rejected'; handleReplacementConflicts?: boolean }) => Promise<{ success: boolean }>,
    handleReplacementConflicts?: boolean
  ): Promise<ApprovalResult> {
    // AI : Find item by ID and validate existence
    const item = items.find(i => i.id === id)
    if (!item) {
      return {
        success: false,
        error: 'not_found',
        message: t(`moderation.${itemType}NotFound`)
      }
    }

    const itemName = item.name ?? (itemType === 'project' ? 'Unknown Project' : 'Unknown')

    // AI : Derive error messages from itemType and status
    const failureMessageKey = status === 'approved' 
      ? `moderation.${itemType}ApprovalFailed` 
      : `moderation.${itemType}RejectionFailed`

    // AI : Use version-aware approval endpoint with error handling
    const result = await withErrorHandling(
      async () => apiCall({
        id,
        expectedVersion: item.version,
        status,
        handleReplacementConflicts,
      }),
      { errorMessage: `${t(failureMessageKey)}. Please try again.` }
    )

    if (!result) {
      return {
        success: false,
        error: 'unknown',
        message: t(failureMessageKey)
      }
    }

    if (!result.success) {
      // AI : Handle version conflicts - refresh data and return conflict info
      resetModerationLoaded()
      await fetchPendingSubmissions()
      return {
        success: false,
        error: 'version_conflict',
        message: t(`moderation.${itemType}VersionConflict`),
        itemName
      }
    }

    moderationStore.addRecentAction({
      id,
      itemName,
      itemType,
      previousStatus: 'pending',
      newStatus: status,
      timestamp: new Date()
    })

    resetModerationLoaded()
    await fetchPendingSubmissions()

    return {
      success: true,
      itemName
    }
  }

  // AI : Helper function to set overlay approval status using the generic handler
  async function setOverlayStatus(id: string, status: 'approved' | 'rejected', handleReplacementConflicts?: boolean): Promise<ApprovalResult> {
    const overlayStore = useOverlayStore()

    // AI : Get the overlay's replacesOverlayId before approval (for cleanup after)
    const overlay = overlays.value.find(o => o.id === id)
    const replacesOverlayId = overlay?.replacesOverlayId

    const result = await setApprovalStatus(
      id,
      status,
      'overlay',
      overlays.value,
      trpc.moderation.setOverlayApprovalStatusWithVersion.mutate,
      handleReplacementConflicts
    )

    // AI : Update overlay status in overlay store if approval succeeded and overlay is currently rendered
    if (result.success) {
      const overlayObject = overlayStore.overlays[id]

      if (overlayObject) {
        // AI : Update the status in the overlay store
        overlayStore.updateOverlay(id, { status })

        // AI : Update marker tooltip to reflect new status
        updateMarkerTooltip(overlayObject)

        // AI : Update all marker colors to reflect status changes
        updateOverlayMarkersColors(toRef(overlayStore, 'overlays'))
      }

      // AI : If this was a replacement overlay approval with conflict handling, remove the original and competing overlays from map
      if (status === 'approved' && handleReplacementConflicts && replacesOverlayId) {
        // AI : Remove the original overlay that was replaced
        removeOverlayFromMap(replacesOverlayId)

        // AI : Remove competing replacement overlays from the map
        // AI : Find all overlays that tried to replace the same original overlay
        const competingReplacements = Object.values(overlayStore.overlays).filter(
          o => o.replacesOverlayId === replacesOverlayId && o.id !== id
        )

        for (const competing of competingReplacements) {
          removeOverlayFromMap(competing.id)
        }
      }
    }

    return result
  }

  async function approveOverlay(id: string, handleReplacementConflicts?: boolean): Promise<ApprovalResult> {
    return setOverlayStatus(id, 'approved', handleReplacementConflicts)
  }

  async function rejectOverlay(id: string): Promise<ApprovalResult> {
    return setOverlayStatus(id, 'rejected')
  }

  async function undoLastAction() {
    if (moderationStore.recentActions.length === 0) {
      console.warn('No recent actions to undo')
      return false
    }

    const lastAction = moderationStore.recentActions[0]

    const result = await withErrorHandling(
      async () => lastAction.itemType === 'overlay'
        ? trpc.moderation.undoOverlayApprovalStatus.mutate({
            id: lastAction.id,
            status: lastAction.previousStatus,
          })
        : trpc.moderation.undoProjectApprovalStatus.mutate({
            id: lastAction.id,
            status: lastAction.previousStatus,
          }),
      { errorMessage: 'Failed to undo action. Please try again.' }
    )

    if (!result) {
      return false
    }

    moderationStore.removeLastAction()
    resetModerationLoaded()
    await fetchPendingSubmissions()
    return true
  }

  // AI : Only fetch on mount if user is admin OR if country is already selected
  // AI : For moderators with assigned countries, wait for country selection in ModerationPanel
  onMounted(async () => {
    const authStore = useAuthStore()
    const user = authStore.user

    if (!user) return

    const isAdmin = user.role === 'admin'
    const hasSelectedCountry = moderationStore.selectedCountryCode !== null

    // AI : Fetch if admin (no country needed) OR if country already selected
    if (isAdmin || hasSelectedCountry) {
      await fetchPendingSubmissions()
    }
  })

  // AI : Helper function to set project approval status using the generic handler
  async function setProjectStatus(id: string, status: 'approved' | 'rejected'): Promise<ApprovalResult> {
    return setApprovalStatus(
      id,
      status,
      'project',
      projects.value,
      trpc.moderation.setProjectApprovalStatusWithVersion.mutate
    )
  }

  async function approveProject(id: string): Promise<ApprovalResult> {
    return setProjectStatus(id, 'approved')
  }

  async function rejectProject(id: string): Promise<ApprovalResult> {
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
    fetchPendingSubmissions,
  }
}
