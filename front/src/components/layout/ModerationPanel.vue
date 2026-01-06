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

    <!-- AI : Rejection Dialog with optional report user -->
    <RejectionDialog
      v-model:visible="showRejectConfirmDialog"
      :user-id="pendingRejection?.userId ?? null"
      :pending-overlay-count="pendingOverlayCount"
      :is-loading="isProcessingRejection"
      @confirm="handleRejectionConfirm"
      @cancel="handleRejectionCancel"
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
      >
        <template #option="{ option }">
          <div class="country-option">
            <span>{{ option.name }}</span>
            <Badge
              v-if="getPendingCount(option.code) > 0"
              :value="getPendingCount(option.code)"
              severity="warn"
            />
          </div>
        </template>
      </Select>
    </div>

    <!-- AI : Message when moderator needs to select a country -->
    <div v-if="showCountrySelector && !selectedCountryCode" class="no-country-message">
      <i class="pi pi-info-circle"></i>
      <p>{{ $t('moderation.pleaseSelectCountry') }}</p>
    </div>

    <!-- AI : Projects Section - pure approve/reject workflow for pending items -->
    <ProjectAccordionPanel
      v-else
      :projects="filteredProjects"
      :change-requests="filteredChangeRequests"
      :is-loading="isLoading"
      title="Pending Projects"
      panel-class="moderation-panel"
      empty-message="All projects reviewed!"
      empty-sub-message="No pending projects to moderate."
      :show-user-stats-link="true"
      :disable-auto-mode-switch="true"
      @show-user-stats="handleShowUserStats"
      :on-overlay-click="handleViewOverlayPosition"
    >
      <template #header-actions>
        <!-- AI : Header button slot - reserved for future actions -->
      </template>

      <template #project-actions="{ project }">
        <!-- AI : Show moderation buttons for pending projects -->
        <ModerationActionButtons
          v-if="project.status === 'pending'"
          @approve="handleApproveProject(project.id)"
          @reject="handleRejectProject(project.id, project.ownerId ?? null)"
        />
      </template>

      <template #overlay-actions="{ overlay, project }">
        <!-- AI : Show approve/reject buttons only when project is NOT pending (approved/rejected) -->
        <!-- AI : This allows moderators to approve overlays once project is approved, -->
        <!-- AI : and reject overlays even if project is rejected -->
        <ModerationActionButtons
          v-if="overlay.status === 'pending' && project.status !== 'pending'"
          :disabled="!!overlay.replacesOverlayId && !viewedOverlayIds.includes(overlay.id)"
          :disabled-tooltip="overlay.replacesOverlayId && !viewedOverlayIds.includes(overlay.id) ? $t('overlay.viewPositionRequired') : ''"
          @approve="handleApproveOverlay(overlay.id)"
          @reject="handleRejectOverlay(overlay.id, overlay.authorId)"
        />
        <!-- AI : Show locked button (padlock) when project is still pending -->
        <!-- AI : This prevents approving overlays before their parent project is approved -->
        <button
          v-if="overlay.status === 'pending' && project.status === 'pending'"
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
          @approve="handleApproveChange(change.id)"
          @reject="handleRejectChange(change.id, change.requestedBy)"
        />
      </template>
    </ProjectAccordionPanel>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useModeration } from '@/composables/moderation/useModeration'
import { useChangeRequests } from '@/composables/changes/useChanges'
import { useOverlayClickHandler } from '@/composables/overlay/useOverlayClickHandler'
import { useChangeRequestPreview } from '@/composables/overlay/useChangeRequestPreview'
import { useToast } from '@/composables/ui/useToast'
import { useAuthStore } from '@/stores/authStore'
import { useModerationStore } from '@/stores/pinia/moderationStore'
import { useMapStore } from '@/stores/pinia/mapStore'
import { useProjectStore } from '@/stores/pinia/projectStore'
import { useOverlayStore } from '@/stores/pinia/overlayStore'
import type { OverlayForModeration } from '@/types/index'
import { trpc } from '@/client'
import { addCityMarkersForCountry } from '@/composables/map/useCityMarkers'
import { mobileAwareFlyTo } from '@/composables/map/useMapNavigation'
import { map } from '@/composables/core/useMap'
import ProjectAccordionPanel from './ProjectAccordionPanel.vue'
import ReplacementConflictsDialog, { type ReplacementConflicts } from '@/components/moderation/ReplacementConflictsDialog.vue'
import ReportUserDialog from '@/components/moderation/ReportUserDialog.vue'
import UserStatsDialog from '@/components/moderation/UserStatsDialog.vue'
import ModerationActionButtons from '@/components/moderation/ModerationActionButtons.vue'
import RejectionDialog from '@/components/moderation/RejectionDialog.vue'

// AI : Use i18n for translations
const { t } = useI18n()

// AI : Auth and moderation stores for country filtering
const authStore = useAuthStore()
const moderationStore = useModerationStore()
const mapStore = useMapStore()
const overlayStore = useOverlayStore()
const projectStore = useProjectStore()

// AI : Country selector state - use store's cached countries
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
    return moderationStore.allCountries
  }

  // AI : Handle edge case where moderatedCountries might not be an array at runtime
  if (!Array.isArray(userCountries)) {
    console.warn('moderatedCountries is not an array:', userCountries)
    return moderationStore.allCountries
  }

  // AI : Filter to only moderator's assigned countries
  return moderationStore.allCountries.filter(country =>
    userCountries.includes(country.code)
  )
})

// AI : Fetch all countries on mount only if not already cached, and auto-select if only one available
onMounted(async () => {
  try {
    // AI : Restore state from Store or Map logic BEFORE fetching countries
    // AI : This ensures markers are loaded immediately if we are returning to the panel
    const initialCode = mapStore.selectedCountryCode ?? moderationStore.selectedCountryCode
    if (initialCode) {
      const user = authStore.user
      const canAccess = !user?.moderatedCountries || user.moderatedCountries.includes(initialCode)
      if (canAccess) {
        // AI : Restore markers. useModeration hook (running after this) will see the store value and fetch the list.
        await loadCountryData(initialCode)
      }
    }

    // AI : Only fetch if not already loaded in store
    if (!moderationStore.countriesLoaded) {
      countriesLoading.value = true
      const countries = await trpc.country.getAllCountries.query()
      moderationStore.setAllCountries(countries)
    }

    // AI : Auto-select country if non-admin moderator has exactly one assigned country
    const user = authStore.user
    const isAdmin = user?.role === 'admin'
    // AI : Check if we DIDN'T restore a country already
    if (!selectedCountryCode.value && !isAdmin && availableCountries.value.length === 1) {
      const singleCountryCode = availableCountries.value[0].code
      // AI : Use shared loader
      await loadCountryData(singleCountryCode)
      // AI : Explicitly fetch pending submissions because useModeration hook ran already (saw null)
      await fetchPendingSubmissions()
    }

    // AI : Fetch pending counts for all countries only if not already loaded
    if (!moderationStore.pendingCountsLoaded) {
      try {
        const counts = await trpc.moderation.getPendingCountsByCountry.query()
        moderationStore.setPendingCounts(counts)
      } catch (error) {
        console.error('Failed to load pending counts:', error)
        // AI : Don't block UI if counts fail to load
      }
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
// AI : Load data for a specific country (markers, pending submissions, etc.)
async function loadCountryData(countryCode: string | null, shouldFly = true) {
  // AI : Sync local ref if needed (e.g. when called from watcher/mounted)
  if (selectedCountryCode.value !== countryCode) {
    selectedCountryCode.value = countryCode
  }

  // AI : Update stores
  // AI : Optim: Only invalidate moderation data if country changed (allows cache reuse)
  const isDifferentCountry = moderationStore.selectedCountryCode !== countryCode
  moderationStore.setSelectedCountryCode(countryCode)

  if (isDifferentCountry) {
    moderationStore.resetModerationLoaded()
  }

  // AI : Load city markers for the selected country
  if (countryCode) {
    try {
      // AI : Fetch cities for the selected country in moderation mode
      const cities = await trpc.cities.getCitiesWithProjects.query({
        countryCode,
        mode: 'moderation'
      })

      // AI : Add city markers to the map
      addCityMarkersForCountry(cities, countryCode)
      // AI : City markers loaded - viewport manager handles viewport-based loading

      // AI : Update mapStore to keep state in sync
      mapStore.selectedCountryCode = countryCode

      // AI : Fly to the country center if available AND requested
      if (shouldFly) {
        const country = projectStore.countries.find(c => c.code === countryCode)
        if (country && map.value) {
          // AI : PostGIS geometry uses x for longitude and y for latitude
          mobileAwareFlyTo([country.centerCoordinates.y, country.centerCoordinates.x], 6, { duration: 1.5 })
        }
      }
    } catch (error) {
      console.error('Failed to load city markers for country:', error)
      toast.add({
        severity: 'error',
        summary: t('common.error'),
        detail: t('moderation.failedToLoadCityMarkers'),
        life: 3000
      })
    }
  }

  // AI : fetchPendingSubmissions removed from here to avoid double fetch on mount
  // AI : It must be called explicitly by callers (handler, watcher, or auto-select)
}

// AI : Handle country selection change
async function handleCountryChange() {
  await loadCountryData(selectedCountryCode.value)
  await fetchPendingSubmissions()
}

// AI : Watch for external changes to moderationStore.selectedCountryCode (e.g., from country marker clicks)
// AI : This ensures the moderation panel loads data when country is selected from the map
watch(
  () => moderationStore.selectedCountryCode,
  (newCountryCode) => {
    if (newCountryCode !== selectedCountryCode.value) {
      selectedCountryCode.value = newCountryCode
      if (newCountryCode) {
        // AI : Use shared loader to ensure city markers are loaded too
        loadCountryData(newCountryCode)
        fetchPendingSubmissions()
      }
    }
  }
)

// AI : Get pending count for a specific country
function getPendingCount(countryCode: string): number {
  return moderationStore.pendingCountsByCountry.get(countryCode) ?? 0
}

// AI : Helper to refetch pending counts after operations
async function refetchPendingCounts() {
  try {
    moderationStore.resetPendingCounts()
    const counts = await trpc.moderation.getPendingCountsByCountry.query()
    moderationStore.setPendingCounts(counts)
  } catch (error) {
    console.error('Failed to refetch pending counts:', error)
  }
}

// AI : Use moderation composable
const {
  projects,
  overlays, // AI : Added overlays for filtering logic
  changeRequests,
  approveProject,
  rejectProject,
  approveOverlay,
  rejectOverlay,
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

// AI : Rejection confirmation dialog state
const showRejectConfirmDialog = ref(false)
const isProcessingRejection = ref(false)

// AI : Pending rejection state (stores type, id, and userId for report functionality)
const pendingRejection = ref<{
  type: 'project' | 'overlay' | 'change'
  id: string
  userId: string | null
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

// AI : Computed: Pending overlay count for current rejection (only for projects)
const pendingOverlayCount = computed(() => {
  if (pendingRejection.value?.type !== 'project') return 0

  const project = projects.value.find(p => p.id === pendingRejection.value?.id)
  if (!project) return 0

  return project.overlays?.filter(o => o.status === 'pending').length ?? 0
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

// AI : Filter projects based on selected city
const filteredProjects = computed(() => {
  if (!mapStore.selectedCity) return projects.value
  return projects.value.filter(p => p.cityId === mapStore.selectedCity?.id)
})

// AI : Filter change requests based on selected city
// AI : Use mapStore cache to verify if entities belong to the selected city
// AI : This works even for approved entities that aren't in the pending 'projects'/'overlays' lists
const filteredChangeRequests = computed(() => {
  const selectedCity = mapStore.selectedCity
  if (!selectedCity) return changeRequests.value

  const cityId = selectedCity.id

  // AI : Get loaded data for this city in current mode
  const currentMode = overlayStore.mode
  const cityOverlays = mapStore.getCityOverlaysAndProjectsCache(cityId, currentMode) ?? []
  const cityStandalone = mapStore.getCityStandaloneProjectsCache(cityId, currentMode) ?? []

  // AI : Build lookups for valid entities in this city
  const validProjectIds = new Set<string>()
  const validOverlayIds = new Set<string>()

  // AI : Add overlays and their projects
  for (const overlay of cityOverlays) {
    validOverlayIds.add(overlay.id)
    if (overlay.projectId) {
      validProjectIds.add(overlay.projectId)
    }
  }

  // AI : Add standalone projects
  for (const project of cityStandalone) {
    validProjectIds.add(project.id)
  }

  // AI : Filter change requests that target entities in this city
  return changeRequests.value.filter(cr => {
    if (cr.entityType === 'project') return validProjectIds.has(cr.entityId)
    if (cr.entityType === 'overlay') return validOverlayIds.has(cr.entityId)
    return false
  })
})

// AI : Watch for city selection to auto-switch country if needed
watch(
  () => mapStore.selectedCity,
  async (city) => {
    if (city && city.countryCode) {
      // AI : Only switch if different (avoids reload loop)
      if (selectedCountryCode.value !== city.countryCode) {
        selectedCountryCode.value = city.countryCode
        // AI : Handle the country change logic (fetch data)
        // AI : Suppress fly because we are already centered on the city (or flying to it)
        await loadCountryData(city.countryCode, false)
        await fetchPendingSubmissions()
      }
    }
  }
)


// AI : Clear pending rejection if report dialog is closed without reporting
watch(showReportDialog, (isOpen) => {
  if (!isOpen && pendingRejection.value) {
    pendingRejection.value = null
  }
})

// AI : Handle overlay zoom and mark as viewed
async function handleViewOverlayPosition(overlay: OverlayForModeration, shouldFitBounds: boolean) {
  if (!viewedOverlayIds.value.includes(overlay.id)) {
    viewedOverlayIds.value.push(overlay.id)
  }
  await handleOverlayClickNavigation(overlay, shouldFitBounds)
}

// AI : Helper to show success toast and refetch pending counts
function showSuccessToast(summaryKey: string, detailKey: string, severity: 'success' | 'info' = 'success') {
  refetchPendingCounts()
  toast.add({
    severity,
    summary: t(summaryKey),
    detail: t(detailKey),
    life: 3000
  })
}

// AI : Helper to show error toast with version conflict handling
function showErrorToast(result: { error?: string; message?: string }, approvalFailedKey: string) {
  const severity = result.error === 'version_conflict' ? 'warn' : 'error'
  const summary = result.error === 'version_conflict' ? t('moderation.projectUpdated') : t(approvalFailedKey)

  toast.add({
    severity,
    summary,
    detail: result.message,
    life: result.error === 'version_conflict' ? 5000 : 3000
  })
}

// AI : Handle project approval with toast notifications
async function handleApproveProject(id: string) {
  const result = await approveProject(id)

  if (result.success) {
    showSuccessToast('moderation.projectApproved', 'moderation.projectApprovedDetail')
  } else {
    showErrorToast(result, 'moderation.approvalFailed')
  }
}

// AI : Handle project rejection - show confirmation dialog first
function handleRejectProject(id: string, userId: string | null) {
  pendingRejection.value = { type: 'project', id, userId }
  showRejectConfirmDialog.value = true
}

// AI : Execute project rejection after confirmation
async function executeRejectProject(id: string, rejectionReason?: string, rejectAllOverlays?: boolean) {
  const result = await rejectProject(id, rejectionReason, rejectAllOverlays)

  if (result.success) {
    showSuccessToast('moderation.projectRejected', 'moderation.projectRejectedDetail', 'info')
  } else {
    showErrorToast(result, 'moderation.rejectionFailed')
  }
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
    showSuccessToast('moderation.overlayApproved', 'moderation.overlayApprovedDetail')
  } else {
    showErrorToast(result, 'moderation.approvalFailed')
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

// AI : Handle when a user is reported from the old ReportUserDialog (legacy path)
// AI : Note: This is now mostly unused since reporting is handled in the RejectionDialog
async function handleUserReported() {
  // AI : Just refresh the moderation data
  moderationStore.resetModerationLoaded()
  await fetchPendingSubmissions()
}

// AI : Handle overlay rejection - show confirmation dialog first
function handleRejectOverlay(id: string, userId: string | null) {
  pendingRejection.value = { type: 'overlay', id, userId }
  showRejectConfirmDialog.value = true
}

// AI : Execute overlay rejection after confirmation
async function executeRejectOverlay(id: string, rejectionReason?: string) {
  const result = await rejectOverlay(id, rejectionReason)

  if (result.success) {
    showSuccessToast('moderation.overlayRejected', 'moderation.overlayRejectedDetail', 'info')
  } else {
    showErrorToast(result, 'moderation.rejectionFailed')
  }
}

// AI : Handle change request approval with toast notifications
async function handleApproveChange(changeId: string) {
  const result = await approveChangeRequests([changeId])

  if (result?.success) {
    refetchPendingCounts()
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

// AI : Handle rejection confirmation from dialog
async function handleRejectionConfirm(options: { rejectionReason: string; rejectAllOverlays: boolean; reportUser: boolean; reportReason: string }) {
  if (!pendingRejection.value) return

  isProcessingRejection.value = true
  const { type, id, userId } = pendingRejection.value

  try {
    // AI : Execute the rejection with rejection reason and optional overlay cascade
    if (type === 'project') {
      await executeRejectProject(id, options.rejectionReason, options.rejectAllOverlays)
    } else if (type === 'overlay') {
      await executeRejectOverlay(id, options.rejectionReason)
    } else if (type === 'change') {
      await executeRejectChange(id)
    }

    // AI : If user checked "report user" and we have a userId, report them
    if (options.reportUser && userId) {
      try {
        await trpc.moderation.reportUser.mutate({
          userId,
          reason: options.reportReason || undefined
        })
        toast.add({
          severity: 'info',
          summary: t('moderation.reportUser.reportSuccess'),
          detail: t('moderation.reportUser.reportSuccessDetail'),
          life: 3000
        })
      } catch (error) {
        console.error('Failed to report user:', error)
        toast.add({
          severity: 'error',
          summary: t('moderation.reportUser.reportFailed'),
          life: 3000
        })
      }
    }
  } finally {
    isProcessingRejection.value = false
    showRejectConfirmDialog.value = false
    pendingRejection.value = null
  }
}

// AI : Handle rejection cancellation from dialog
function handleRejectionCancel() {
  pendingRejection.value = null
}

// AI : Handle change request rejection - show confirmation dialog first
function handleRejectChange(changeId: string, userId: string | null) {
  pendingRejection.value = { type: 'change', id: changeId, userId }
  showRejectConfirmDialog.value = true
}

// AI : Execute change request rejection after confirmation
async function executeRejectChange(changeId: string) {
  const result = await rejectChangeRequests([changeId])

  if (result?.success) {
    refetchPendingCounts()
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
</script>

<style scoped>
/* AI : Import shared panel CSS */
@import '../../assets/panel-common.css';

/* AI : Main moderation container */
.moderation-container {
  display: flex;
  flex-direction: column;
}

/* AI : Moderation header actions - align button to the right */
.moderation-header-actions {
  display: flex;
  justify-content: flex-end;
  width: 100%;
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

/* AI : Country option with pending count badge */
.country-option {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  width: 100%;
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
</style>
