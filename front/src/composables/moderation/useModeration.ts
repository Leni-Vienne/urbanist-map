import { computed, onMounted } from "vue";
import { trpc } from "@/client";

import { useModerationStore } from "@/stores/moderationStore";
import { useOverlayStore } from "@/stores/overlayStore";
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

    async function submitApproval(): Promise<{ success: boolean }> {
      if (isOverlay) {
        return trpc.moderation.setOverlayApprovalStatusWithVersion.mutate({
          id,
          expectedVersion,
          status,
          rejectionReason: request.rejectionReason,
        });
      }

      return trpc.moderation.setProjectApprovalStatusWithVersion.mutate({
        id,
        expectedVersion,
        status,
        rejectionReason: request.rejectionReason,
        rejectAllOverlays: request.rejectAllOverlays,
      });
    }

    async function submitApprovalOrNull(): Promise<{ success: boolean } | null> {
      try {
        return await submitApproval();
      } catch (error) {
        console.error(`Failed to set ${itemType} moderation status:`, error);
        await fetchPendingSubmissions({ force: true });
        return null;
      }
    }

    const result = await submitApprovalOrNull();
    if (!result) {
      return {
        success: false,
        error: "unknown",
        message: t(failureMessageKey),
      };
    }

    // Refetch so the panel reflects the new server state, whether the write
    // succeeded or hit a version conflict.
    await fetchPendingSubmissions({ force: true });

    if (!result.success) {
      return {
        success: false,
        error: "version_conflict",
        message: t(`moderation.${itemType}VersionConflict`),
      };
    }

    useLatestContributionsStore().invalidateLatestContributions();

    return {
      success: true,
    };
  }

  async function setOverlayStatus(
    id: string,
    status: "approved" | "rejected",
    rejectionReason?: string,
  ): Promise<ApprovalResult> {
    const overlayStore = useOverlayStore();

    const overlay = overlays.value.find((o) => o.id === id);
    const replacesOverlayId = overlay?.replacesOverlayId;

    const result = await setApprovalStatus({
      id,
      status,
      itemType: "overlay",
      rejectionReason,
    });

    if (result.success) {
      const overlayObject = overlayStore.liveOverlays[id];

      if (overlayObject) {
        overlayStore.updatePersistedOverlay(id, { status });
      }

      // If a replacement overlay was approved, remove the original and any competing replacements
      if (status === "approved" && replacesOverlayId) {
        removeOverlayFromState(replacesOverlayId);

        const competingReplacements = Object.values(overlayStore.liveOverlays).filter(
          (o) => o.replacesOverlayId === replacesOverlayId && o.id !== id,
        );

        for (const competing of competingReplacements) {
          removeOverlayFromState(competing.id);
        }
      }
    }

    return result;
  }

  async function approveOverlay(id: string): Promise<ApprovalResult> {
    return setOverlayStatus(id, "approved");
  }

  async function rejectOverlay(id: string, rejectionReason?: string): Promise<ApprovalResult> {
    return setOverlayStatus(id, "rejected", rejectionReason);
  }

  async function approveProject(id: string): Promise<ApprovalResult> {
    return setApprovalStatus({ id, status: "approved", itemType: "project" });
  }

  async function rejectProject(
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
  };
}
