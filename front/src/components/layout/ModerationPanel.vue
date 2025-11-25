<template>
  <div class="moderation-container">
    <!-- AI : Replacement Conflicts Dialog -->
    <ReplacementConflictsDialog
      v-model:visible="showConflictsDialog"
      :conflicts="pendingConflicts"
      :is-loading="isProcessingConflicts"
      @confirm="handleConfirmReplacement"
      @cancel="handleCancelReplacement"
    />

    <!-- AI : Report User Dialog -->
    <ReportUserDialog
      v-model:visible="showReportDialog"
      :user-id="userToReport"
      @reported="handleUserReported"
    />

    <!-- AI : User Stats Dialog -->
    <UserStatsDialog
      v-model:visible="showUserStatsDialog"
      :user-id="userStatsDialogData.userId"
      :username="userStatsDialogData.username"
      :approved-count="userStatsDialogData.approvedCount"
      :rejected-count="userStatsDialogData.rejectedCount"
      :report-count="userStatsDialogData.reportCount"
      @report="openReportDialog"
    />

    <!-- AI : Country Selector for Moderation -->
    <div v-if="showCountrySelector" class="country-selector-container">
      <label for="country-select" class="country-selector-label">
        <i class="pi pi-globe"></i>
        {{ $t('moderation.selectCountry') }}:
      </label>
      <Select
        id="country-select"
        v-model="selectedCountryCode"
        :options="availableCountries"
        option-label="name"
        option-value="code"
        :placeholder="$t('moderation.chooseCountry')"
        :filter="availableCountries.length > 10"
        :loading="countriesLoading"
        @change="handleCountryChange"
        class="country-dropdown"
      />
    </div>

    <!-- AI : Message when moderator needs to select a country -->
    <div v-if="showCountrySelector && !selectedCountryCode" class="no-country-message">
      <i class="pi pi-info-circle"></i>
      <p>{{ $t('moderation.pleaseSelectCountry') }}</p>
    </div>

    <!-- AI : Projects Section - pure approve/reject workflow for pending items -->
    <ProjectAccordionPanel
      v-else
      :projects="projects"
      :change-requests="changeRequests"
      :is-loading="isLoading"
      title="Pending Projects"
      panel-class="moderation-panel"
      empty-message="All projects reviewed!"
      empty-sub-message="No pending projects to moderate."
      :show-user-stats-link="true"
      @show-user-stats="handleShowUserStats"
      :on-overlay-click="handleViewOverlayPosition"
    >
    <template #header-actions>
      <Button
        icon="pi pi-undo"
        @click="handleUndo"
        :disabled="!canUndo"
        size="small"
        :label="$t('actions.undo')"
        severity="secondary"
        v-tooltip.top="undoTooltip"
        :aria-label="$t('tooltips.undo')"
      />
    </template>

    <template #project-actions="{ project }">
      <!-- AI : Show moderation buttons for pending projects or orphan projects -->
      <ModerationActionButtons
        v-if="project.status === 'pending' || project.isOrphan"
        :approve-disabled="project.isOrphan"
        :disabled-tooltip="project.isOrphan ? $t('moderation.alreadyApproved') : ''"
        :user-id="project.ownerId ?? null"
        @approve="handleApproveProject(project.id)"
        @reject="handleRejectProject(project.id)"
        @reject-and-report="handleRejectAndReportProject(project.id, project.ownerId ?? null)"
      />
    </template>

    <template #overlay-actions="{ overlay, project }">
      <!-- AI : Show moderation buttons for pending overlays if project is approved -->
      <ModerationActionButtons
        v-if="overlay.status === 'pending' && project.status === 'approved'"
        :disabled="!!overlay.replacesOverlayId && !viewedOverlayIds.includes(overlay.id)"
        :disabled-tooltip="overlay.replacesOverlayId && !viewedOverlayIds.includes(overlay.id) ? $t('overlay.viewPositionRequired') : ''"
        :user-id="overlay.authorId"
        @approve="handleApproveOverlay(overlay.id)"
        @reject="handleRejectOverlay(overlay.id)"
        @reject-and-report="handleRejectAndReportOverlay(overlay.id, overlay.authorId)"
      />
      <!-- AI : Show locked button if project not approved yet -->
      <button
        v-if="overlay.status === 'pending' && project.status !== 'approved'"
        class="action-btn disabled-btn"
        disabled
        v-tooltip.top="$t('tooltips.approveProjectFirst')"
      >
        <i class="pi pi-lock"></i>
      </button>
    </template>

    <template #change-actions="{ change }">
      <!-- AI : Show moderation buttons for change requests -->
      <ModerationActionButtons
        :disabled="isGeometryChange(change) && !hasViewedSuggestedPosition(change.id)"
        :disabled-tooltip="isGeometryChange(change) && !hasViewedSuggestedPosition(change.id) ? $t('overlay.viewSuggestedPosition') : ''"
        :user-id="change.requestedBy"
        @approve="handleApproveChange(change.id)"
        @reject="handleRejectChange(change.id)"
        @reject-and-report="handleRejectAndReportChange(change.id, change.requestedBy)"
      />
    </template>

    </ProjectAccordionPanel>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch, onMounted, nextTick } from 'vue'
import { useI18n } from 'vue-i18n'
import { useModeration } from '@composables/moderation/useModeration'
import { useChangeRequests } from '@composables/changes/useChanges'
import { useOverlayClickHandler } from '@composables/overlay/useOverlayClickHandler'
import { useChangeRequestPreview } from '@composables/overlay/useChangeRequestPreview'
import { useToast } from '@composables/ui/useToast'
import { useAuthStore } from '@stores/authStore'
import { useModerationStore } from '@stores/pinia/moderationStore'
import { useAccordionState } from '@composables/layout/useAccordionState'
import { trpc } from '@client'
import ProjectAccordionPanel from './ProjectAccordionPanel.vue'
import ReplacementConflictsDialog from '@components/moderation/ReplacementConflictsDialog.vue'
import ReportUserDialog from '@components/moderation/ReportUserDialog.vue'
import UserStatsDialog from '@components/moderation/UserStatsDialog.vue'
import ModerationActionButtons from '@components/moderation/ModerationActionButtons.vue'
import type { ReplacementConflicts } from '@components/moderation/ReplacementConflictsDialog.vue'

// AI : Use i18n for translations
const { t } = useI18n()

// AI : Auth and moderation stores for country filtering
const authStore = useAuthStore()
const moderationStore = useModerationStore()

// AI : Accordion state for auto-expanding countries
const { expandedCountries } = useAccordionState()

// AI : Country selector state
const allCountries = ref<Array<{ code: string; name: string }>>([])
const countriesLoading = ref(false)
const selectedCountryCode = ref<string | null>(moderationStore.selectedCountryCode)

// AI : Computed: show country selector if user is not admin and has access to multiple countries
const showCountrySelector = computed(() => {
  const user = authStore.user
  if (!user) return false

  // AI : Admin role or null moderatedCountries = no country selector needed
  const isAdmin = user.role === 'admin'
  if (isAdmin) return true

  // AI : Hide selector if moderator only has access to one country
  return availableCountries.value.length > 1
})

// AI : Computed: filter countries by user's moderatedCountries
const availableCountries = computed(() => {
  const userCountries = authStore.user?.moderatedCountries

  // AI : Admin (null or undefined) sees all countries
  if (userCountries === null || userCountries === undefined) {
    return allCountries.value
  }

  // AI : Handle edge case where moderatedCountries might not be an array at runtime
  if (!Array.isArray(userCountries)) {
    console.warn('moderatedCountries is not an array:', userCountries)
    return allCountries.value
  }

  // AI : Filter to only moderator's assigned countries
  return allCountries.value.filter(country =>
    userCountries.includes(country.code)
  )
})

// AI : Fetch all countries on mount and auto-select if only one available
onMounted(async () => {
  try {
    countriesLoading.value = true
    const countries = await trpc.country.getAllCountries.query()
    allCountries.value = countries

    // AI : Auto-select country if non-admin moderator has exactly one assigned country
    const user = authStore.user
    const isAdmin = user?.role === 'admin'
    if (!isAdmin && availableCountries.value.length === 1) {
      const singleCountryCode = availableCountries.value[0].code
      selectedCountryCode.value = singleCountryCode
      moderationStore.setSelectedCountryCode(selectedCountryCode.value)
      // AI : Manually fetch pending submissions after auto-selecting country
      // AI : This is necessary because useModeration's onMounted skips fetch when no country is selected yet
      await fetchPendingSubmissions()
    }
  } catch (error) {
    console.error('Failed to load countries:', error)
    toast.add({
      severity: 'error',
      summary: t('common.error'),
      detail: t('moderation.failedToLoadCountries'),
      life: 3000
    })
  } finally {
    countriesLoading.value = false
  }
})

// AI : Handle country selection change
function handleCountryChange() {
  moderationStore.setSelectedCountryCode(selectedCountryCode.value)
  moderationStore.resetModerationLoaded()
  fetchPendingSubmissions()
}

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
  fetchPendingSubmissions,
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

// AI : Use change request preview composable to track when suggested positions are viewed
const { previewState } = useChangeRequestPreview()

// AI : Track which overlay positions have been viewed by the moderator (using array for better reactivity)
const viewedOverlayIds = ref<string[]>([])

// AI : Track which change request suggested positions have been viewed
const viewedChangeRequestIds = ref<string[]>([])

// AI : Replacement conflicts dialog state
const showConflictsDialog = ref(false)
const pendingConflicts = ref<ReplacementConflicts | null>(null)
const pendingOverlayId = ref<string | null>(null)
const isProcessingConflicts = ref(false)

// AI : Report user dialog state
const showReportDialog = ref(false)
const userToReport = ref<string | null>(null)

// AI : Pending rejection state (for reject+report flow)
const pendingRejection = ref<{
  type: 'project' | 'overlay' | 'change'
  id: string
} | null>(null)

// AI : Dialog state for user stats
const showUserStatsDialog = ref(false)
const userStatsDialogData = ref({
  userId: null as string | null,
  username: null as string | null,
  approvedCount: 0,
  rejectedCount: 0,
  reportCount: 0
})

// AI : Check if a change request is for a geometry field (corners or centroid)
function isGeometryChange(change: any): boolean {
  return change.fieldName === 'corners' || change.fieldName === 'centroid'
}

// AI : Check if a geometry change request's suggested position has been viewed
function hasViewedSuggestedPosition(changeId: string): boolean {
  return viewedChangeRequestIds.value.includes(changeId)
}

// AI : Watch preview state and mark change as viewed when suggested position is shown
watch(
  previewState,
  (state) => {
    if (state.type === 'suggested' && !viewedChangeRequestIds.value.includes(state.changeId)) {
      viewedChangeRequestIds.value.push(state.changeId)
    }
  },
  { deep: true }
)

// AI : Clear pending rejection if report dialog is closed without reporting
watch(showReportDialog, (isOpen) => {
  if (!isOpen && pendingRejection.value) {
    pendingRejection.value = null
  }
})

// AI : Handle overlay zoom and mark as viewed
async function handleViewOverlayPosition(overlay: any, shouldFitBounds: boolean) {
  if (!viewedOverlayIds.value.includes(overlay.id)) {
    viewedOverlayIds.value.push(overlay.id)
  }
  await handleOverlayClickNavigation(overlay, shouldFitBounds)
}

// AI : Computed properties for undo functionality
const canUndo = computed(() => recentActions.value.length > 0)
const lastAction = computed(() => recentActions.value[0] || null)

// AI : Computed tooltip for undo button
const undoTooltip = computed(() => {
  if (!canUndo.value || !lastAction.value) return t('actions.noActionsToUndo')

  const action = lastAction.value
  const actionText = action.newStatus === 'approved' ? 'approved' : 'rejected'
  const entityText = action.itemType === 'project' ? 'project' : 'overlay'
  return t('moderation.undoAction', { action: actionText, entity: entityText, name: action.itemName })
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
      summary: t('moderation.projectApproved'),
      detail: t('moderation.projectApprovedDetail'),
      life: 3000
    })
  } else {
    const severity = result.error === 'version_conflict' ? 'warn' : 'error'
    const summary = result.error === 'version_conflict' ? t('moderation.projectUpdated') : t('moderation.approvalFailed')

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
      summary: t('moderation.projectRejected'),
      detail: t('moderation.projectRejectedDetail'),
      life: 3000
    })
  } else {
    const severity = result.error === 'version_conflict' ? 'warn' : 'error'
    const summary = result.error === 'version_conflict' ? t('moderation.projectUpdated') : t('moderation.rejectionFailed')

    toast.add({
      severity,
      summary,
      detail: result.message,
      life: result.error === 'version_conflict' ? 5000 : 3000
    })
  }
}

// AI : Handle project rejection and report user (reject only after report confirmation)
async function handleRejectAndReportProject(projectId: string, userId: string | null) {
  if (!userId) return

  pendingRejection.value = { type: 'project', id: projectId }
  openReportDialog(userId)
}

// AI : Handle overlay approval with replacement conflict checking
async function handleApproveOverlay(id: string) {
  try {
    // AI : First check if this overlay is a replacement and if it has conflicts
    const overlay = projects.value
      .flatMap(p => p.overlays)
      .find(o => o.id === id)

    if (overlay?.replacesOverlayId) {
      // AI : Check for conflicts before approving
      const conflicts = await trpc.moderation.checkReplacementConflicts.query({ overlayId: id })

      if (conflicts.hasConflicts) {
        // AI : Show confirmation dialog
        pendingConflicts.value = conflicts
        pendingOverlayId.value = id
        showConflictsDialog.value = true
        return // Wait for user confirmation
      }

      // AI : No conflicts but it IS a replacement - handle replacement workflow
      await proceedWithApproval(id, true)
      return
    }

    // AI : Not a replacement - proceed with normal approval
    await proceedWithApproval(id, false)
  } catch (error) {
    console.error('Error checking replacement conflicts:', error)
    toast.add({
      severity: 'error',
      summary: t('common.error'),
      detail: t('errors.checkConflictsFailed'),
      life: 3000
    })
  }
}

// AI : Proceed with overlay approval (called after confirmation or directly if no conflicts)
async function proceedWithApproval(id: string, handleConflicts = false) {
  const result = await approveOverlay(id, handleConflicts)

  if (result.success) {
    toast.add({
      severity: 'success',
      summary: t('moderation.overlayApproved'),
      detail: t('moderation.overlayApprovedDetail'),
      life: 3000
    })
  } else {
    const severity = result.error === 'version_conflict' ? 'warn' : 'error'
    const summary = result.error === 'version_conflict' ? t('moderation.projectUpdated') : t('moderation.approvalFailed')

    toast.add({
      severity,
      summary,
      detail: result.message,
      life: result.error === 'version_conflict' ? 5000 : 3000
    })
  }
}

// AI : Handle confirmation from replacement conflicts dialog
async function handleConfirmReplacement() {
  if (!pendingOverlayId.value) return

  isProcessingConflicts.value = true
  try {
    await proceedWithApproval(pendingOverlayId.value, true) // Pass true to handle conflicts
  } finally {
    isProcessingConflicts.value = false
    showConflictsDialog.value = false
    pendingOverlayId.value = null
    pendingConflicts.value = null
  }
}

// AI : Handle cancellation from replacement conflicts dialog
function handleCancelReplacement() {
  showConflictsDialog.value = false
  pendingOverlayId.value = null
  pendingConflicts.value = null
}

// AI : Open report user dialog
function openReportDialog(userId: string | null) {
  if (!userId) return
  userToReport.value = userId
  showReportDialog.value = true
}

// AI : Open user stats dialog
function handleShowUserStats(data: { userId: string; username?: string | null; approvedCount?: number | null; rejectedCount?: number | null; reportCount?: number }) {
  userStatsDialogData.value = {
    userId: data.userId,
    username: data.username ?? null,
    approvedCount: data.approvedCount ?? 0,
    rejectedCount: data.rejectedCount ?? 0,
    reportCount: data.reportCount ?? 0
  }
  showUserStatsDialog.value = true
}

// AI : Handle when a user is reported - execute pending rejection if exists, then refresh
async function handleUserReported() {
  // AI : Execute pending rejection if user confirmed the report
  if (pendingRejection.value) {
    const { type, id } = pendingRejection.value

    if (type === 'project') {
      await handleRejectProject(id)
    } else if (type === 'overlay') {
      await handleRejectOverlay(id)
    } else if (type === 'change') {
      await handleRejectChange(id)
    }

    pendingRejection.value = null
  }

  moderationStore.resetModerationLoaded()
  await fetchPendingSubmissions()
}

// AI : Handle overlay rejection with toast notifications
async function handleRejectOverlay(id: string) {
  const result = await rejectOverlay(id)

  if (result.success) {
    toast.add({
      severity: 'info',
      summary: t('moderation.overlayRejected'),
      detail: t('moderation.overlayRejectedDetail'),
      life: 3000
    })
  } else {
    const severity = result.error === 'version_conflict' ? 'warn' : 'error'
    const summary = result.error === 'version_conflict' ? t('moderation.projectUpdated') : t('moderation.rejectionFailed')

    toast.add({
      severity,
      summary,
      detail: result.message,
      life: result.error === 'version_conflict' ? 5000 : 3000
    })
  }
}

// AI : Handle overlay rejection and report user (reject only after report confirmation)
async function handleRejectAndReportOverlay(overlayId: string, userId: string | null) {
  if (!userId) return

  pendingRejection.value = { type: 'overlay', id: overlayId }
  openReportDialog(userId)
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

    // AI : Refetch pending submissions to update UI (removes approved change and competing conflicted changes)
    await fetchPendingSubmissions()
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

    // AI : Refetch pending submissions to update UI
    await fetchPendingSubmissions()
  } else {
    toast.add({
      severity: 'error',
      summary: t('moderation.rejectionFailed'),
      detail: t('moderation.rejectionFailedDetail'),
      life: 3000
    })
  }
}

// AI : Handle change request rejection and report user (reject only after report confirmation)
async function handleRejectAndReportChange(changeId: string, userId: string | null) {
  if (!userId) return

  pendingRejection.value = { type: 'change', id: changeId }
  openReportDialog(userId)
}

</script>

<style scoped>
/* AI : Main moderation container */
.moderation-container {
  display: flex;
  flex-direction: column;
}

/* AI : Country selector styling */
.country-selector-container {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.5rem 0.75rem;
  background: var(--p-surface-50);
  border: 1px solid var(--p-surface-200);
  border-radius: 6px;
}

.country-selector-label {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-weight: 600;
  color: var(--p-surface-700);
  font-size: 0.9375rem;
  white-space: nowrap;
}

.country-selector-label i {
  color: var(--p-primary-color);
}

.country-dropdown {
  flex: 1;
  min-width: 200px;
  max-width: 300px;
}


/* AI : No country selected message */
.no-country-message {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 1.5rem;
  background: var(--p-blue-50);
  border: 1px solid var(--p-blue-200);
  border-radius: 6px;
  color: var(--p-blue-700);
}

.no-country-message i {
  font-size: 1.5rem;
  color: var(--p-blue-600);
}

.no-country-message p {
  margin: 0;
  font-size: 0.9375rem;
  font-weight: 500;
}

/* AI : Locked button style for overlays when project not approved */
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

<!-- AI : Global styles for portal-based overlays that render outside component scope -->
<style>
/* AI : Ensure Select dropdown overlay appears above mode outline (z-index 1050) */
.p-select-overlay {
  z-index: 1100 !important;
}
</style>
