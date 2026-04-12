<template>
  <div class="h-full flex flex-col">
    <!-- Replacement Conflicts Dialog -->
    <ReplacementConflictsDialog
      v-model:visible="showConflictsDialog"
      :conflicts="pendingConflicts"
      :is-loading="isProcessingConflicts"
      @confirm="handleConfirmReplacement"
      @cancel="handleCancelReplacement"
    />

    <!-- Report User Dialog -->
    <ReportUserDialog
      v-model:visible="showReportDialog"
      :user-id="userToReport"
      @reported="handleUserReported"
    />

    <!-- User Stats Dialog -->
    <UserStatsDialog
      v-model:visible="showUserStatsDialog"
      :user-id="userStatsDialogData.userId"
      :username="userStatsDialogData.username"
      :approved-count="userStatsDialogData.approvedCount"
      :rejected-count="userStatsDialogData.rejectedCount"
      :report-count="userStatsDialogData.reportCount"
      @report="openReportDialog"
    />

    <!-- Rejection Dialog with optional report user -->
    <RejectionDialog
      v-model:visible="showRejectConfirmDialog"
      :user-id="pendingRejection?.userId ?? null"
      :pending-overlay-count="pendingOverlayCount"
      :is-loading="isProcessingRejection"
      @confirm="handleRejectionConfirm"
      @cancel="handleRejectionCancel"
    />

    <!-- Country Selector for Moderation -->
    <div
      v-if="showCountrySelector"
      class="flex items-center gap-3 px-3 py-2 bg-content-hover-background border border-surface rounded-md"
    >
      <label
        for="country-select"
        class="flex items-center gap-2 font-semibold text-color text-[0.9375rem] whitespace-nowrap"
      >
        <i class="pi pi-globe text-primary"></i>
        {{ $t("moderation.selectCountry") }}:
      </label>
      <Select
        id="country-select"
        v-model="selectedCountryCode"
        :options="availableCountries"
        option-label="name"
        option-value="code"
        :placeholder="countriesLoading ? $t('common.loading') : $t('moderation.chooseCountry')"
        :filter="availableCountries.length > 10"
        :disabled="countriesLoading && availableCountries.length === 0"
        @change="handleCountryChange"
        class="flex-1 min-w-50 max-w-75"
      >
        <template #option="{ option }">
          <div class="flex items-center justify-between gap-2 w-full">
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

    <!-- Message when moderator needs to select a country -->
    <div
      v-if="showCountrySelector && !selectedCountryCode"
      class="flex items-center gap-3 p-6 bg-content-background border border-surface rounded-md text-color"
    >
      <i class="pi pi-info-circle text-2xl text-primary-color"></i>
      <p class="m-0 text-[0.9375rem] font-medium">
        {{ $t("moderation.pleaseSelectCountry") }}
      </p>
    </div>

    <!-- Projects Section - pure approve/reject workflow for pending items -->
    <div v-else class="flex-1 min-h-0">
      <ProjectAccordionPanel
        :projects="filteredProjects"
        :change-requests="filteredChangeRequests"
        :is-loading="isLoading"
        :title="$t('moderation.pendingProjects')"
        panel-class="moderation-panel"
        :empty-message="$t('moderation.allReviewed')"
        :empty-sub-message="$t('moderation.noPendingItems')"
        :show-user-stats-link="true"
        :disable-auto-mode-switch="true"
        @show-user-stats="handleShowUserStats"
        :on-overlay-click="handleViewOverlayPosition"
      >
        <template #project-actions="{ project }">
          <!-- Show moderation buttons for pending projects -->
          <ModerationActionButtons
            v-if="project.status === 'pending'"
            @approve="handleApproveProject(project.id)"
            @reject="handleRejectProject(project.id, project.ownerId ?? null)"
          />
        </template>

        <template #overlay-actions="{ overlay, project }">
          <!-- Show approve/reject buttons only when project is NOT pending (approved/rejected) -->
          <!-- This allows moderators to approve overlays once project is approved, -->
          <!-- and reject overlays even if project is rejected -->
          <ModerationActionButtons
            v-if="overlay.status === 'pending' && project.status !== 'pending'"
            :disabled="Boolean(overlay.replacesOverlayId) && !viewedOverlayIds.includes(overlay.id)"
            :disabled-tooltip="
              overlay.replacesOverlayId && !viewedOverlayIds.includes(overlay.id)
                ? $t('overlay.viewPositionRequired')
                : ''
            "
            @approve="handleApproveOverlay(overlay.id)"
            @reject="handleRejectOverlay(overlay.id, overlay.authorId)"
          />
          <!-- Show locked button (padlock) when project is still pending -->
          <!-- This prevents approving overlays before their parent project is approved -->
          <button
            v-if="overlay.status === 'pending' && project.status === 'pending'"
            class="w-8 h-8 border border-surface rounded-md bg-content-background flex items-center justify-center text-muted-color cursor-not-allowed opacity-60"
            disabled
            v-tooltip.top="$t('tooltips.approveProjectFirst')"
          >
            <i class="pi pi-lock"></i>
          </button>
        </template>

        <template #change-actions="{ change }">
          <!-- Show moderation buttons for change requests -->
          <ModerationActionButtons
            :disabled="isGeometryChange(change) && !hasViewedSuggestedPosition(change.id)"
            :disabled-tooltip="
              isGeometryChange(change) && !hasViewedSuggestedPosition(change.id)
                ? $t('overlay.viewSuggestedPosition')
                : ''
            "
            @approve="handleApproveChange(change.id)"
            @reject="handleRejectChange(change.id, change.requestedBy)"
          />
        </template>
      </ProjectAccordionPanel>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch, onMounted } from "vue";
import { useI18n } from "vue-i18n";
import { useModeration } from "@/composables/moderation/useModeration";
import { useChangeRequests } from "@/composables/changes/useChanges";
import { useChangeRequestPreview } from "@/composables/overlay/useChangeRequestPreview";
import { useToast } from "@/composables/ui/useToast";
import { useAuthStore } from "@/stores/authStore";
import { useModerationStore } from "@/stores/pinia/moderationStore";
import { useMapStore } from "@/stores/pinia/mapStore";
import type { OverlayForModeration } from "@/types/index";
import { trpc } from "@/client";
import { mobileAwareFlyTo } from "@/services/map/mapNavigation";
import { useOverlayClickHandler } from "@/composables/overlay/useOverlayClickHandler";

import ProjectAccordionPanel from "./ProjectAccordionPanel.vue";
import ReplacementConflictsDialog, {
  type ReplacementConflicts,
} from "@/components/moderation/ReplacementConflictsDialog.vue";
import ReportUserDialog from "@/components/moderation/ReportUserDialog.vue";
import UserStatsDialog from "@/components/moderation/UserStatsDialog.vue";
import ModerationActionButtons from "@/components/moderation/ModerationActionButtons.vue";
import RejectionDialog from "@/components/moderation/RejectionDialog.vue";

const { t } = useI18n();
const { handleOverlayClickNavigation } = useOverlayClickHandler();

// Auth and moderation stores for country filtering
const authStore = useAuthStore();
const moderationStore = useModerationStore();
const mapStore = useMapStore();
// Country selector state - use store's cached countries
const countriesLoading = ref(false);
const selectedCountryCode = ref<string | null>(moderationStore.selectedCountryCode);

// Computed: show country selector if user is not admin and has access to multiple countries
const showCountrySelector = computed(() => {
  const user = authStore.user;
  if (!user) return false;

  // Admin role or null moderatedCountries = no country selector needed
  const isAdmin = user.role === "admin";
  if (isAdmin) return true;

  // Hide selector if moderator only has access to one country
  return availableCountries.value.length > 1;
});

// Computed: filter countries by user's moderatedCountries
const availableCountries = computed(() => {
  const userCountries = authStore.user?.moderatedCountries;

  // Admin (null or undefined) sees all countries
  if (userCountries === null || userCountries === undefined) {
    return moderationStore.allCountries;
  }

  // Handle edge case where moderatedCountries might not be an array at runtime
  if (!Array.isArray(userCountries)) {
    console.warn("moderatedCountries is not an array:", userCountries);
    return moderationStore.allCountries;
  }

  // Filter to only moderator's assigned countries
  return moderationStore.allCountries.filter((country) => userCountries.includes(country.code));
});

// Fetch all countries on mount only if not already cached, and auto-select if only one available
onMounted(async () => {
  try {
    // Restore state from Store or Map logic BEFORE fetching countries
    // This ensures markers are loaded immediately if we are returning to the panel
    const initialCode = mapStore.selectedCountryCode ?? moderationStore.selectedCountryCode ?? null;
    if (initialCode) {
      const user = authStore.user;
      const canAccess = !user?.moderatedCountries || user.moderatedCountries.includes(initialCode);
      if (canAccess) {
        // Restore markers. useModeration hook (running after this) will see the store value and fetch the list.
        loadCountryData(initialCode, true);
      }
    }

    // Only fetch if not already loaded in store
    if (!moderationStore.countriesLoaded) {
      countriesLoading.value = true;
      const countries = await trpc.country.getAllCountries.query();
      moderationStore.setAllCountries(countries);
    }

    // Auto-select country if non-admin moderator has exactly one assigned country
    const user = authStore.user;
    const isAdmin = user?.role === "admin";
    // Check if we DIDN'T restore a country already
    if (!selectedCountryCode.value && !isAdmin && availableCountries.value.length === 1) {
      const country = availableCountries.value[0];
      if (!country) {
        throw new Error("No country found");
      }
      // Use shared loader
      loadCountryData(country.code);
      // Explicitly fetch pending submissions because useModeration hook ran already (saw null)
      await fetchPendingSubmissions();
    }

    // Fetch pending counts for all countries only if not already loaded
    if (!moderationStore.pendingCountsLoaded) {
      try {
        const counts = await trpc.moderation.getPendingCountsByCountry.query();
        moderationStore.setPendingCounts(counts);
      } catch (error) {
        console.error("Failed to load pending counts:", error);
        // Don't block UI if counts fail to load
      }
    }
  } catch (error) {
    console.error("Failed to load countries:", error);
    toast.add({
      severity: "error",
      summary: t("common.error"),
      detail: t("moderation.failedToLoadCountries"),
      life: 3000,
    });
  } finally {
    countriesLoading.value = false;
  }
});

// Load data for a specific country (stores, fly-to)
// City markers are managed globally by the mode watcher, no need to reload per country
function loadCountryData(countryCode: string | null, shouldFly = true) {
  // Sync local ref if needed (e.g. when called from watcher/mounted)
  if (selectedCountryCode.value !== countryCode) {
    selectedCountryCode.value = countryCode;
  }

  // Only invalidate moderation data if country changed (allows cache reuse)
  const isDifferentCountry = moderationStore.selectedCountryCode !== countryCode;
  moderationStore.setSelectedCountryCode(countryCode);
  if (isDifferentCountry) {
    moderationStore.resetModerationLoaded();
  }

  if (countryCode) {
    mapStore.selectedCountryCode = countryCode;

    if (shouldFly) {
      const country = moderationStore.allCountries.find((c) => c.code === countryCode);
      if (country) {
        mobileAwareFlyTo([country.centerCoordinates.y, country.centerCoordinates.x], 6, {
          duration: 1.5,
        });
      }
    }
  }
}

// Handle country selection change
async function handleCountryChange() {
  loadCountryData(selectedCountryCode.value);
  await fetchPendingSubmissions();
}

// Watch for external changes to moderationStore.selectedCountryCode (e.g., from city marker clicks)
// This ensures the moderation panel loads data when country is selected from the map
watch(
  () => moderationStore.selectedCountryCode,
  (newCountryCode) => {
    if (newCountryCode !== selectedCountryCode.value) {
      selectedCountryCode.value = newCountryCode;
      if (newCountryCode) {
        // Use shared loader to ensure city markers are loaded too
        loadCountryData(newCountryCode);
        fetchPendingSubmissions();
      }
    }
  },
);

// Get pending count for a specific country
function getPendingCount(countryCode: string): number {
  return moderationStore.pendingCountsByCountry.get(countryCode) ?? 0;
}

// Helper to refetch pending counts after operations
async function refetchPendingCounts() {
  try {
    moderationStore.resetPendingCounts();
    const counts = await trpc.moderation.getPendingCountsByCountry.query();
    moderationStore.setPendingCounts(counts);
  } catch (error) {
    console.error("Failed to refetch pending counts:", error);
  }
}

// Use moderation composable
const {
  projects,
  changeRequests,
  approveProject,
  rejectProject,
  approveOverlay,
  rejectOverlay,
  fetchPendingSubmissions,
} = useModeration();

const { approveChangeRequests, rejectChangeRequests } = useChangeRequests();

// Show loading state when a country is selected but data hasn't been fetched yet
const isLoading = computed(
  () => Boolean(selectedCountryCode.value) && !moderationStore.moderationLoaded,
);
const toast = useToast();

// Use change request preview composable to track when suggested positions are viewed
const { previewState } = useChangeRequestPreview();

// Track which overlay positions have been viewed by the moderator (using array for better reactivity)
const viewedOverlayIds = ref<string[]>([]);

// Track which change request suggested positions have been viewed
const viewedChangeRequestIds = ref<string[]>([]);

// Replacement conflicts dialog state
const showConflictsDialog = ref(false);
const pendingConflicts = ref<ReplacementConflicts | null>(null);
const pendingOverlayId = ref<string | null>(null);
const isProcessingConflicts = ref(false);

// Report user dialog state
const showReportDialog = ref(false);
const userToReport = ref<string | null>(null);

// Rejection confirmation dialog state
const showRejectConfirmDialog = ref(false);
const isProcessingRejection = ref(false);

// Pending rejection state (stores type, id, and userId for report functionality)
const pendingRejection = ref<{
  type: "project" | "overlay" | "change";
  id: string;
  userId: string | null;
} | null>(null);

// Dialog state for user stats
const showUserStatsDialog = ref(false);
const userStatsDialogData = ref({
  userId: null as string | null,
  username: null as string | null,
  approvedCount: 0,
  rejectedCount: 0,
  reportCount: 0,
});

// Computed: Pending overlay count for current rejection (only for projects)
const pendingOverlayCount = computed(() => {
  if (pendingRejection.value?.type !== "project") return 0;

  const project = projects.value.find((p) => p.id === pendingRejection.value?.id);
  if (!project) return 0;

  return project.overlays?.filter((o) => o.status === "pending").length ?? 0;
});

// Check if a change request is for a geometry field (corners or centroid)
function isGeometryChange(change: any): boolean {
  return change.fieldName === "corners" || change.fieldName === "centroid";
}

// Check if a geometry change request's suggested position has been viewed
function hasViewedSuggestedPosition(changeId: string): boolean {
  return viewedChangeRequestIds.value.includes(changeId);
}

// Watch preview state and mark change as viewed when suggested position is shown
watch(
  previewState,
  (state) => {
    if (state.type === "suggested" && !viewedChangeRequestIds.value.includes(state.changeId)) {
      viewedChangeRequestIds.value.push(state.changeId);
    }
  },
  { deep: true },
);

// Show all projects for the selected country (no city filtering)
const filteredProjects = computed(() => projects.value);

// Show all change requests for the selected country (no city filtering)
const filteredChangeRequests = computed(() => changeRequests.value);

// Clear pending rejection if report dialog is closed without reporting
watch(showReportDialog, (isOpen) => {
  if (!isOpen && pendingRejection.value) {
    pendingRejection.value = null;
  }
});

// Handle overlay zoom and mark as viewed
async function handleViewOverlayPosition(overlay: OverlayForModeration, shouldFitBounds: boolean) {
  if (!viewedOverlayIds.value.includes(overlay.id)) {
    viewedOverlayIds.value.push(overlay.id);
  }
  await handleOverlayClickNavigation(overlay, shouldFitBounds);
}

// Helper to show success toast and refetch pending counts
function showSuccessToast(
  summaryKey: string,
  detailKey: string,
  severity: "success" | "info" = "success",
) {
  refetchPendingCounts();
  toast.add({
    severity,
    summary: t(summaryKey),
    detail: t(detailKey),
    life: 3000,
  });
}

// Helper to show error toast with version conflict handling
function showErrorToast(result: { error?: string; message?: string }, approvalFailedKey: string) {
  const severity = result.error === "version_conflict" ? "warn" : "error";
  const summary =
    result.error === "version_conflict" ? t("moderation.projectUpdated") : t(approvalFailedKey);

  toast.add({
    severity,
    summary,
    detail: result.message,
    life: result.error === "version_conflict" ? 5000 : 3000,
  });
}

// Handle project approval with toast notifications
async function handleApproveProject(id: string) {
  const result = await approveProject(id);

  if (result.success) {
    showSuccessToast("moderation.projectApproved", "moderation.projectApprovedDetail");
  } else {
    showErrorToast(result, "moderation.approvalFailed");
  }
}

// Handle project rejection - show confirmation dialog first
function handleRejectProject(id: string, userId: string | null) {
  pendingRejection.value = { type: "project", id, userId };
  showRejectConfirmDialog.value = true;
}

// Execute project rejection after confirmation
async function executeRejectProject(
  id: string,
  rejectionReason?: string,
  rejectAllOverlays?: boolean,
) {
  const result = await rejectProject(id, rejectionReason, rejectAllOverlays);

  if (result.success) {
    showSuccessToast("moderation.projectRejected", "moderation.projectRejectedDetail", "info");
  } else {
    showErrorToast(result, "moderation.rejectionFailed");
  }
}

// Handle overlay approval with replacement conflict checking
async function handleApproveOverlay(id: string) {
  try {
    // First check if this overlay is a replacement and if it has conflicts
    const overlay = projects.value.flatMap((p) => p.overlays).find((o) => o.id === id);

    if (overlay?.replacesOverlayId) {
      // Check for conflicts before approving
      const conflicts = await trpc.moderation.checkReplacementConflicts.query({
        overlayId: id,
      });

      if (conflicts.hasConflicts) {
        // Show confirmation dialog
        pendingConflicts.value = conflicts;
        pendingOverlayId.value = id;
        showConflictsDialog.value = true;
        return; // Wait for user confirmation
      }

      // No conflicts but it IS a replacement - handle replacement workflow
      await proceedWithApproval(id, true);
      return;
    }

    // Not a replacement - proceed with normal approval
    await proceedWithApproval(id, false);
  } catch (error) {
    console.error("Error checking replacement conflicts:", error);
    toast.add({
      severity: "error",
      summary: t("common.error"),
      detail: t("errors.checkConflictsFailed"),
      life: 3000,
    });
  }
}

// Proceed with overlay approval (called after confirmation or directly if no conflicts)
async function proceedWithApproval(id: string, handleConflicts = false) {
  const result = await approveOverlay(id, handleConflicts);

  if (result.success) {
    showSuccessToast("moderation.overlayApproved", "moderation.overlayApprovedDetail");
  } else {
    showErrorToast(result, "moderation.approvalFailed");
  }
}

// Handle confirmation from replacement conflicts dialog
async function handleConfirmReplacement() {
  if (!pendingOverlayId.value) return;

  isProcessingConflicts.value = true;
  try {
    await proceedWithApproval(pendingOverlayId.value, true); // Pass true to handle conflicts
  } finally {
    isProcessingConflicts.value = false;
    showConflictsDialog.value = false;
    pendingOverlayId.value = null;
    pendingConflicts.value = null;
  }
}

// Handle cancellation from replacement conflicts dialog
function handleCancelReplacement() {
  showConflictsDialog.value = false;
  pendingOverlayId.value = null;
  pendingConflicts.value = null;
}

// Open report user dialog
function openReportDialog(userId: string | null) {
  if (!userId) return;
  userToReport.value = userId;
  showReportDialog.value = true;
}

// Open user stats dialog
function handleShowUserStats(data: {
  userId: string;
  username?: string | null;
  approvedCount?: number | null;
  rejectedCount?: number | null;
  reportCount?: number;
}) {
  userStatsDialogData.value = {
    userId: data.userId,
    username: data.username ?? null,
    approvedCount: data.approvedCount ?? 0,
    rejectedCount: data.rejectedCount ?? 0,
    reportCount: data.reportCount ?? 0,
  };
  showUserStatsDialog.value = true;
}

async function handleUserReported() {
  // Just refresh the moderation data
  moderationStore.resetModerationLoaded();
  await fetchPendingSubmissions();
}

// Handle overlay rejection - show confirmation dialog first
function handleRejectOverlay(id: string, userId: string | null) {
  pendingRejection.value = { type: "overlay", id, userId };
  showRejectConfirmDialog.value = true;
}

// Execute overlay rejection after confirmation
async function executeRejectOverlay(id: string, rejectionReason?: string) {
  const result = await rejectOverlay(id, rejectionReason);

  if (result.success) {
    showSuccessToast("moderation.overlayRejected", "moderation.overlayRejectedDetail", "info");
  } else {
    showErrorToast(result, "moderation.rejectionFailed");
  }
}

// Handle change request approval with toast notifications
async function handleApproveChange(changeId: string) {
  const result = await approveChangeRequests([changeId]);

  if (result) {
    refetchPendingCounts();
    toast.add({
      severity: "success",
      summary: t("moderation.changeApproved"),
      detail: t("moderation.changeApprovedDetail"),
      life: 3000,
    });

    // Refetch pending submissions to update UI (removes approved change and competing conflicted changes)
    await fetchPendingSubmissions();
  } else {
    toast.add({
      severity: "error",
      summary: t("moderation.approvalFailed"),
      detail: t("moderation.approvalFailedDetail"),
      life: 3000,
    });
  }
}

// Handle rejection confirmation from dialog
async function handleRejectionConfirm(options: {
  rejectionReason: string;
  rejectAllOverlays: boolean;
  reportUser: boolean;
  reportReason: string;
}) {
  if (!pendingRejection.value) return;

  isProcessingRejection.value = true;
  const { type, id, userId } = pendingRejection.value;

  try {
    // Execute the rejection with rejection reason and optional overlay cascade
    if (type === "project") {
      await executeRejectProject(id, options.rejectionReason, options.rejectAllOverlays);
    } else if (type === "overlay") {
      await executeRejectOverlay(id, options.rejectionReason);
    } else if (type === "change") {
      await executeRejectChange(id);
    }

    // If user checked "report user" and we have a userId, report them
    if (options.reportUser && userId) {
      try {
        await trpc.moderation.reportUser.mutate({
          userId,
          reason: options.reportReason || undefined,
        });
        toast.add({
          severity: "info",
          summary: t("moderation.reportUser.reportSuccess"),
          detail: t("moderation.reportUser.reportSuccessDetail"),
          life: 3000,
        });
      } catch (error) {
        console.error("Failed to report user:", error);
        toast.add({
          severity: "error",
          summary: t("moderation.reportUser.reportFailed"),
          life: 3000,
        });
      }
    }
  } finally {
    isProcessingRejection.value = false;
    showRejectConfirmDialog.value = false;
    pendingRejection.value = null;
  }
}

// Handle rejection cancellation from dialog
function handleRejectionCancel() {
  pendingRejection.value = null;
}

// Handle change request rejection - show confirmation dialog first
function handleRejectChange(changeId: string, userId: string | null) {
  pendingRejection.value = { type: "change", id: changeId, userId };
  showRejectConfirmDialog.value = true;
}

// Execute change request rejection after confirmation
async function executeRejectChange(changeId: string) {
  const result = await rejectChangeRequests([changeId]);

  if (result) {
    refetchPendingCounts();
    toast.add({
      severity: "info",
      summary: t("moderation.changeRejected"),
      detail: t("moderation.changeRejectedDetail"),
      life: 3000,
    });

    // Refetch pending submissions to update UI
    await fetchPendingSubmissions();
  } else {
    toast.add({
      severity: "error",
      summary: t("moderation.rejectionFailed"),
      detail: t("moderation.rejectionFailedDetail"),
      life: 3000,
    });
  }
}
</script>
