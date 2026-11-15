import { computed, onMounted } from "vue";
import { trpc } from "@/client";

import { useModerationStore } from "@/stores/moderationStore";
import { useOverlayStore } from "@/stores/overlayStore";
import { useProjectStore } from "@/stores/projectStore";
import { useContributionStore } from "@/stores/contributionStore";
import { useAuthStore } from "@/stores/authStore";
import { removeOverlayFromState } from "@/services/entity/entityRemoval";
import { t } from "@/locales";
import { useLatestContributionsStore } from "@/stores/latestContributionsStore";
import { canModerateCountry } from "@/services/moderation/moderationCountrySync";

export type ApprovalResult = {
  success: boolean;
  error?: "not_found" | "version_conflict" | "unknown";
  message?: string;
};

type ApprovalRequest = {
  id: string;
  status: "approved" | "rejected";
  itemType: "overlay" | "project";
  rejectionReason?: string;
  rejectAllOverlays?: boolean;
};

export function useModeration() {
  const moderationStore = useModerationStore();

  const projects = computed(() => moderationStore.projects);
  const overlays = computed(() => Object.values(moderationStore.overlaysById));
  const changeRequests = computed(() => moderationStore.changeRequests);

  const { fetchPendingSubmissions } = moderationStore;

  async function refreshAfterDecision(affected: { projectIds: string[]; overlayIds: string[] }) {
    useContributionStore().invalidateRequests();
    useLatestContributionsStore().invalidateLatestContributions();
    const results = await Promise.allSettled([
      ...affected.projectIds.map((id) => useProjectStore().loadProjectDetail(id, true)),
      ...affected.overlayIds.map((id) => useOverlayStore().loadOverlay(id, true)),
    ]);
    for (const result of results) {
      if (result.status === "rejected")
        console.error("Failed to refresh moderated contribution:", result.reason);
    }
    await fetchPendingSubmissions({ force: true });
  }

  async function setApprovalStatus(request: ApprovalRequest): Promise<ApprovalResult> {
    const { id, status, itemType } = request;
    const isOverlay = itemType === "overlay";
    const items: { id: string; version: number }[] = isOverlay ? overlays.value : projects.value;

    const item = items.find((i) => i.id === id);
    if (!item) {
      return {
        success: false,
        error: "not_found",
        message: t(`moderation.${itemType}NotFound`),
      };
    }

    const failureMessageKey =
      status === "approved"
        ? `moderation.${itemType}ApprovalFailed`
        : `moderation.${itemType}RejectionFailed`;

    const expectedVersion = item.version;
    const projectId = isOverlay ? moderationStore.overlaysById[id]?.projectId : id;
    const rejectedImageIds = isOverlay
      ? [id]
      : overlays.value.flatMap((image) =>
          request.rejectAllOverlays && image.projectId === id && image.status === "pending"
            ? [image.id]
            : [],
        );
    const auth = useAuthStore();
    const epoch = auth.getSessionEpoch();

    let result;
    try {
      result = isOverlay
        ? await trpc.moderation.setOverlayApprovalStatusWithVersion.mutate({
            id,
            expectedVersion,
            status,
            rejectionReason: request.rejectionReason,
          })
        : await trpc.moderation.setProjectApprovalStatusWithVersion.mutate({
            id,
            expectedVersion,
            status,
            rejectionReason: request.rejectionReason,
            rejectAllOverlays: request.rejectAllOverlays,
          });
    } catch (error) {
      console.error(`Failed to set ${itemType} moderation status:`, error);
      await fetchPendingSubmissions({ force: true });
      return { success: false, error: "unknown", message: t(failureMessageKey) };
    }
    if (auth.getSessionEpoch() !== epoch) return { success: false, error: "unknown" };
    if (result.success && status === "rejected") {
      for (const imageId of rejectedImageIds) removeOverlayFromState(imageId);
    }
    await refreshAfterDecision({
      projectIds: projectId ? [projectId] : [],
      overlayIds: isOverlay && status === "approved" ? [id] : [],
    });
    if (auth.getSessionEpoch() !== epoch) return { success: false, error: "unknown" };

    if (!result.success) {
      return {
        success: false,
        error: "version_conflict",
        message: t(`moderation.${itemType}VersionConflict`),
      };
    }

    return {
      success: true,
    };
  }

  async function setOverlayStatus(
    id: string,
    status: "approved" | "rejected",
    rejectionReason?: string,
  ): Promise<ApprovalResult> {
    const replacesOverlayId = overlays.value.find((o) => o.id === id)?.replacesOverlayId;

    const result = await setApprovalStatus({
      id,
      status,
      itemType: "overlay",
      rejectionReason,
    });

    // The refreshed entity carries its authoritative version/status. Retire the replaced
    // images too: they disappear from the pending response but can still be cached locally.
    if (result.success && status === "approved" && replacesOverlayId) {
      for (const overlay of Object.values(useOverlayStore().liveOverlays)) {
        if (
          overlay.id === replacesOverlayId ||
          (overlay.replacesOverlayId === replacesOverlayId && overlay.id !== id)
        ) {
          removeOverlayFromState(overlay.id);
        }
      }
    }

    return result;
  }

  function approveOverlay(id: string): Promise<ApprovalResult> {
    return setOverlayStatus(id, "approved");
  }

  function rejectOverlay(id: string, rejectionReason?: string): Promise<ApprovalResult> {
    return setOverlayStatus(id, "rejected", rejectionReason);
  }

  function approveProject(id: string): Promise<ApprovalResult> {
    return setApprovalStatus({ id, status: "approved", itemType: "project" });
  }

  function rejectProject(
    id: string,
    rejectionReason?: string,
    rejectAllOverlays?: boolean,
  ): Promise<ApprovalResult> {
    return setApprovalStatus({
      id,
      status: "rejected",
      itemType: "project",
      rejectionReason,
      rejectAllOverlays,
    });
  }

  onMounted(() => {
    const mapCountryCode = moderationStore.selectedCountryCode;
    if (mapCountryCode && canModerateCountry(mapCountryCode)) {
      void fetchPendingSubmissions({ force: true });
    }
  });

  return {
    projects,
    changeRequests,
    approveOverlay,
    rejectOverlay,
    approveProject,
    rejectProject,
    fetchPendingSubmissions,
    refreshAfterDecision,
  };
}
