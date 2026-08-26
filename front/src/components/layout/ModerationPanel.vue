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
      :is-loading="isProcessingReport"
      @report="handleReportConfirm"
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
      class="flex items-center gap-3 px-3 py-2 bg-(--p-content-hover-background) border border-surface rounded-md"
    >
      <label
        for="country-select"
        class="flex items-center gap-2 font-semibold text-color text-[0.9375rem] whitespace-nowrap"
      >
        <i class="pi pi-globe text-primary-color"></i>
        {{ $t("moderation.selectCountry") }}:
      </label>
      <Select
        inputId="country-select"
        v-model="selectedCountryCode"
        :options="availableCountries"
        option-label="name"
        option-value="code"
        :placeholder="countriesLoading ? $t('common.loading') : $t('moderation.chooseCountry')"
        :filter="availableCountries.length > 10"
        :disabled="countriesLoading && availableCountries.length === 0"
        @change="handleCountryChange"
        class="flex-1 min-w-50 max-w-75"
        appendTo="body"
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
        :projects="projects"
        :change-requests="changeRequests"
        :is-loading="isLoading"
        :title="$t('moderation.pendingProjects')"
        panel-class="moderation-panel"
        :empty-message="$t('moderation.allReviewed')"
        :empty-sub-message="$t('moderation.noPendingItems')"
        :show-user-stats-link="true"
        :list-header-label="$t('moderation.otherPendingProjects')"
        :selected-project-id="selectedProjectId"
        @show-user-stats="handleShowUserStats"
        :on-overlay-click="handleViewOverlayPosition"
      >
        <template #project-actions="{ project }">
          <!-- Show moderation buttons for pending projects -->
          <ModerationActionButtons
            v-if="project.status === 'pending'"
            :loading="isProcessingItem('project', project.id)"
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
            :loading="isProcessingItem('overlay', overlay.id)"
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
            :loading="isProcessingItem('change', change.id)"
            @approve="handleApproveChange(change.id)"
            @reject="handleRejectChange(change.id, change.requestedBy)"
          />
        </template>
      </ProjectAccordionPanel>
    </div>
  </div>
</template>

<script setup lang="ts">
import { toastSuccess, toastInfo, toastWarn, toastError } from "@/services/core/toast";
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useModeration, type ApprovalResult } from "@/composables/moderation/useModeration";
import { useModerationCountrySelector } from "@/composables/moderation/useModerationCountrySelector";
import { approveChangeRequests, rejectChangeRequests } from "@/services/changes/changeRequests";
import { useChangeRequestStore } from "@/stores/changeRequestStore";
import { useModerationStore } from "@/stores/moderationStore";
import type { Overlay, PendingChangeRequest, UserStatsPayload } from "@/types/index";
import { trpc } from "@/client";
import { handleOverlayClickNavigation } from "@/services/overlay/clickHandler";
import { useFocusStore } from "@/stores/focusStore";

import ProjectAccordionPanel from "./ProjectAccordionPanel.vue";
import ReplacementConflictsDialog, {
  type ReplacementConflicts,
} from "@/components/moderation/ReplacementConflictsDialog.vue";
import ReportUserDialog from "@/components/moderation/ReportUserDialog.vue";
import UserStatsDialog from "@/components/moderation/UserStatsDialog.vue";
import ModerationActionButtons from "@/components/moderation/ModerationActionButtons.vue";
import RejectionDialog from "@/components/moderation/RejectionDialog.vue";

const { t } = useI18n();

const moderationStore = useModerationStore();
const changeRequestStore = useChangeRequestStore();

const {
  projects,
  changeRequests,
  approveProject,
  rejectProject,
  approveOverlay,
  rejectOverlay,
  fetchPendingSubmissions,
} = useModeration();

const {
  countriesLoading,
  selectedCountryCode,
  showCountrySelector,
  availableCountries,
  handleCountryChange,
  getPendingCount,
  refetchPendingCounts,
} = useModerationCountrySelector({
  onCountryDataNeeded: fetchPendingSubmissions,
});

// The map-selected project is lifted into the panel's "Selected project" card.
const focusStore = useFocusStore();
const selectedProjectId = computed(() => focusStore.selectedProjectId);

const isLoading = computed(() => moderationStore.moderationLoadStatus === "loading");

// Track which overlay positions have been viewed by the moderator (using array for better reactivity)
const viewedOverlayIds = ref<string[]>([]);

/* Track which change request suggested positions have been viewed */
const viewedChangeRequestIds = ref<string[]>([]);

const showConflictsDialog = ref(false);
const pendingConflicts = ref<ReplacementConflicts | null>(null);
let pendingOverlayId: string | null = null;
const isProcessingConflicts = ref(false);

const showReportDialog = ref(false);
let userToReport: string | null = null;
const isProcessingReport = ref(false);

const showRejectConfirmDialog = ref(false);
const isProcessingRejection = ref(false);
const processingItemKeys = ref<Set<string>>(new Set());

type ModerationItemType = "project" | "overlay" | "change";

function moderationItemKey(type: ModerationItemType, id: string): string {
  return `${type}:${id}`;
}

function isProcessingItem(type: ModerationItemType, id: string): boolean {
  return processingItemKeys.value.has(moderationItemKey(type, id));
}

function startProcessingItem(type: ModerationItemType, id: string): boolean {
  const key = moderationItemKey(type, id);
  if (processingItemKeys.value.has(key)) return false;
  processingItemKeys.value = new Set(processingItemKeys.value).add(key);
  return true;
}

function stopProcessingItem(type: ModerationItemType, id: string): void {
  const nextKeys = new Set(processingItemKeys.value);
  nextKeys.delete(moderationItemKey(type, id));
  processingItemKeys.value = nextKeys;
}

interface PendingRejectionExecution {
  type: "project" | "overlay" | "change";
  id: string;
}

interface PendingRejection extends PendingRejectionExecution {
  userId: string | null;
}

interface RejectionOptions {
  rejectionReason: string;
  rejectAllOverlays: boolean;
  reportUser: boolean;
  reportReason: string;
}

const pendingRejection = ref<PendingRejection | null>(null);

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

  return project.overlays.filter((o) => o.status === "pending").length;
});

// Check if a change request is for a geometry field (corners or centroid)
function isGeometryChange(change: PendingChangeRequest): boolean {
  return change.fieldName === "corners" || change.fieldName === "centroid";
}

// Check if a geometry change request's suggested position has been viewed
function hasViewedSuggestedPosition(changeId: string): boolean {
  return viewedChangeRequestIds.value.includes(changeId);
}

// Watch preview state and mark change as viewed when suggested position is shown
watch(
  () => changeRequestStore.previewState,
  (state) => {
    if (state.type === "suggested" && !viewedChangeRequestIds.value.includes(state.changeId)) {
      viewedChangeRequestIds.value.push(state.changeId);
    }
  },
);

async function handleViewOverlayPosition(overlay: Overlay) {
  const navigated = await handleOverlayClickNavigation(overlay);
  if (navigated && !viewedOverlayIds.value.includes(overlay.id)) {
    viewedOverlayIds.value.push(overlay.id);
  }
}

// Helper to show success toast and refetch pending counts
function showSuccessToast(
  summaryKey: string,
  detailKey: string,
  severity: "success" | "info" = "success",
) {
  refetchPendingCounts();
  if (severity === "success") {
    toastSuccess(t(detailKey), t(summaryKey));
  } else {
    toastInfo(t(detailKey), t(summaryKey));
  }
}

// Helper to show error toast with version conflict handling
function showErrorToast(result: ApprovalResult, approvalFailedKey: string) {
  const severity = result.error === "version_conflict" ? "warn" : "error";
  const summary =
    result.error === "version_conflict" ? t("moderation.submissionUpdated") : t(approvalFailedKey);

  if (severity === "warn") toastWarn(result.message, summary);
  else toastError(result.message, summary);
}

// Handle project approval with toast notifications
async function handleApproveProject(id: string) {
  if (!startProcessingItem("project", id)) return;

  try {
    const result = await approveProject(id);

    if (result.success) {
      showSuccessToast("moderation.projectApproved", "moderation.projectApprovedDetail");
    } else {
      showErrorToast(result, "moderation.approvalFailed");
    }
  } finally {
    stopProcessingItem("project", id);
  }
}

// Handle project rejection - show confirmation dialog first
function handleRejectProject(id: string, userId: string | null) {
  pendingRejection.value = { type: "project", id, userId };
  showRejectConfirmDialog.value = true;
}

async function executeRejectProject(
  id: string,
  rejectionReason?: string,
  rejectAllOverlays?: boolean,
): Promise<boolean> {
  const result = await rejectProject(id, rejectionReason, rejectAllOverlays);

  if (result.success) {
    showSuccessToast("moderation.projectRejected", "moderation.projectRejectedDetail", "info");
  } else {
    showErrorToast(result, "moderation.rejectionFailed");
  }

  return result.success;
}

// Handle overlay approval with replacement conflict checking
async function handleApproveOverlay(id: string) {
  if (!startProcessingItem("overlay", id)) return;

  try {
    // First check if this overlay is a replacement and if it has conflicts
    const overlay = projects.value.flatMap((p) => p.overlays).find((o) => o.id === id);

    if (overlay?.replacesOverlayId) {
      const conflicts = await trpc.moderation.checkReplacementConflicts.query({
        overlayId: id,
      });

      if (conflicts) {
        // Show confirmation dialog
        pendingConflicts.value = conflicts;
        pendingOverlayId = id;
        showConflictsDialog.value = true;
        return; // Wait for user confirmation
      }

      // No conflicts but it IS a replacement - handle replacement workflow
      await proceedWithApproval(id);
      return;
    }

    // Not a replacement - proceed with normal approval
    await proceedWithApproval(id);
  } catch (error) {
    console.error("Error checking replacement conflicts:", error);
    toastError(error instanceof Error ? error.message : t("errors.checkConflictsFailed"));
  } finally {
    stopProcessingItem("overlay", id);
  }
}

// Proceed with overlay approval (called after confirmation or directly if no conflicts)
async function proceedWithApproval(id: string) {
  const result = await approveOverlay(id);

  if (result.success) {
    showSuccessToast("moderation.overlayApproved", "moderation.overlayApprovedDetail");
  } else {
    showErrorToast(result, "moderation.approvalFailed");
  }
}

// Handle confirmation from replacement conflicts dialog
async function handleConfirmReplacement() {
  if (!pendingOverlayId) return;
  if (!startProcessingItem("overlay", pendingOverlayId)) return;

  const overlayId = pendingOverlayId;
  isProcessingConflicts.value = true;
  try {
    await proceedWithApproval(overlayId);
  } finally {
    stopProcessingItem("overlay", overlayId);
    isProcessingConflicts.value = false;
    showConflictsDialog.value = false;
    pendingOverlayId = null;
    pendingConflicts.value = null;
  }
}

function handleCancelReplacement() {
  showConflictsDialog.value = false;
  pendingOverlayId = null;
  pendingConflicts.value = null;
}

function openReportDialog(userId: string | null) {
  if (!userId) return;
  userToReport = userId;
  showReportDialog.value = true;
}

async function reportUser(userId: string, reason: string): Promise<boolean> {
  try {
    await trpc.moderation.reportUser.mutate({
      userId,
      reason: reason || undefined,
    });
    toastSuccess(
      t("moderation.reportUser.reportSuccessDetail"),
      t("moderation.reportUser.reportSuccess"),
    );
    await fetchPendingSubmissions({ force: true });
    return true;
  } catch (error) {
    console.error("Failed to report user:", error);
    toastError(
      error instanceof Error ? error.message : undefined,
      t("moderation.reportUser.reportFailed"),
    );
    return false;
  }
}

async function handleReportConfirm(reason: string) {
  if (!userToReport) return;

  isProcessingReport.value = true;
  try {
    if (await reportUser(userToReport, reason)) {
      showReportDialog.value = false;
      userToReport = null;
    }
  } finally {
    isProcessingReport.value = false;
  }
}

function handleShowUserStats(data: UserStatsPayload) {
  userStatsDialogData.value = {
    userId: data.userId,
    username: data.username ?? null,
    approvedCount: data.approvedCount ?? 0,
    rejectedCount: data.rejectedCount ?? 0,
    reportCount: data.reportCount ?? 0,
  };
  showUserStatsDialog.value = true;
}

// Handle overlay rejection - show confirmation dialog first
function handleRejectOverlay(id: string, userId: string | null) {
  pendingRejection.value = { type: "overlay", id, userId };
  showRejectConfirmDialog.value = true;
}

async function executeRejectOverlay(id: string, rejectionReason?: string): Promise<boolean> {
  const result = await rejectOverlay(id, rejectionReason);

  if (result.success) {
    showSuccessToast("moderation.overlayRejected", "moderation.overlayRejectedDetail", "info");
  } else {
    showErrorToast(result, "moderation.rejectionFailed");
  }

  return result.success;
}

async function refreshAfterChangeRequest(): Promise<void> {
  await Promise.all([fetchPendingSubmissions({ force: true }), refetchPendingCounts()]);
}

// Handle change request approval with toast notifications
async function handleApproveChange(changeId: string) {
  if (!startProcessingItem("change", changeId)) return;

  try {
    const result = await approveChangeRequests([changeId]);

    if (result) {
      await refreshAfterChangeRequest();
      toastSuccess(t("moderation.changeApprovedDetail"), t("moderation.changeApproved"));
    } else {
      await refreshAfterChangeRequest();
      toastError(t("moderation.approvalFailedDetail"), t("moderation.approvalFailed"));
    }
  } finally {
    stopProcessingItem("change", changeId);
  }
}

async function executePendingRejection(
  rejection: PendingRejectionExecution,
  options: RejectionOptions,
): Promise<boolean> {
  if (rejection.type === "project") {
    return executeRejectProject(rejection.id, options.rejectionReason, options.rejectAllOverlays);
  }
  if (rejection.type === "overlay") {
    return executeRejectOverlay(rejection.id, options.rejectionReason);
  }
  return executeRejectChange(rejection.id);
}

async function handleRejectionConfirm(options: RejectionOptions) {
  if (!pendingRejection.value) return;

  isProcessingRejection.value = true;
  const rejection = pendingRejection.value;

  try {
    const rejectionSucceeded = await executePendingRejection(rejection, options);
    if (!rejectionSucceeded) return;

    if (options.reportUser && rejection.userId) {
      await reportUser(rejection.userId, options.reportReason);
    }
  } finally {
    isProcessingRejection.value = false;
    showRejectConfirmDialog.value = false;
    pendingRejection.value = null;
  }
}

function handleRejectionCancel() {
  pendingRejection.value = null;
}

// Handle change request rejection - show confirmation dialog first
function handleRejectChange(changeId: string, userId: string | null) {
  pendingRejection.value = { type: "change", id: changeId, userId };
  showRejectConfirmDialog.value = true;
}

// Execute change request rejection after confirmation
async function executeRejectChange(changeId: string): Promise<boolean> {
  const rejected = await rejectChangeRequests([changeId]);

  if (rejected) {
    await refreshAfterChangeRequest();
    toastInfo(t("moderation.changeRejectedDetail"), t("moderation.changeRejected"));
  } else {
    await refreshAfterChangeRequest();
    toastError(t("moderation.rejectionFailedDetail"), t("moderation.rejectionFailed"));
  }

  return rejected;
}
</script>
