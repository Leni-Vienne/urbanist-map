import { computed, onMounted } from "vue";
import { trpc } from "@/client";

import { useModerationStore } from "@/stores/moderationStore";
import { useOverlayStore } from "@/stores/overlayStore";
import { useUiStore } from "@/stores/uiStore";
import { useAuthStore } from "@/stores/authStore";
import { removeOverlayFromMapAndStore } from "@/services/entity/entityRemoval";
import { applyMapSessionRows } from "@/services/map/viewportTriggers";
import { t } from "@/locales";
import { toastError } from "@/services/core/toast";
import { overlayWireToData } from "@/utils/typeFactories";

// Result type for approval operations
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

let moderationFetchToken = 0;

export function useModeration() {
  const moderationStore = useModerationStore();
  const uiStore = useUiStore();
  const authStore = useAuthStore();

  const projects = computed(() => moderationStore.projects);
  const overlays = computed(() => Object.values(moderationStore.overlaysById));
  const changeRequests = computed(() => moderationStore.changeRequests);

  async function fetchPendingSubmissions(options?: { force?: boolean }) {
    const countryCode = moderationStore.selectedCountryCode;
    if (!countryCode) return;
    if (!options?.force && moderationStore.moderationLoadStatus !== "idle") {
      return;
    }

    moderationFetchToken += 1;
    const requestToken = moderationFetchToken;
    const userId = authStore.user?.id;
    moderationStore.startModerationLoading();

    function isCurrentRequest(): boolean {
      return (
        requestToken === moderationFetchToken &&
        uiStore.mode === "moderation" &&
        moderationStore.selectedCountryCode === countryCode &&
        authStore.user?.id === userId
      );
    }

    try {
      const response = await trpc.moderation.getPendingSubmissions.query({
        countryCode,
      });

      if (!isCurrentRequest()) return;

      const mapProjects = [];
      for (const project of Object.values(response.projectsById)) {
        mapProjects.push({ ...project, tags: project.tags ?? [] });
      }

      const projectIds = applyMapSessionRows(
        "moderation",
        mapProjects,
        response.mapOverlays.map(overlayWireToData),
      );

      moderationStore.setModerationData({
        projectIds,
        overlaysById: response.overlaysById,
        changeRequests: response.changeRequests,
      });
    } catch (error) {
      if (!isCurrentRequest()) return;
      moderationStore.stopModerationLoading();
      console.error("Failed to load pending submissions:", error);
      toastError(t("moderation.fetchSubmissionsFailed"));
    }
  }

  // Generic approval handler for any moderation item type
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
        removeOverlayFromMapAndStore(replacesOverlayId);

        const competingReplacements = Object.values(overlayStore.liveOverlays).filter(
          (o) => o.replacesOverlayId === replacesOverlayId && o.id !== id,
        );

        for (const competing of competingReplacements) {
          removeOverlayFromMapAndStore(competing.id);
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

  async function setProjectStatus(
    id: string,
    status: "approved" | "rejected",
    rejectionReason?: string,
    rejectAllOverlays?: boolean,
  ): Promise<ApprovalResult> {
    return setApprovalStatus({
      id,
      status,
      itemType: "project",
      rejectionReason,
      rejectAllOverlays,
    });
  }

  async function approveProject(id: string): Promise<ApprovalResult> {
    return setProjectStatus(id, "approved");
  }

  async function rejectProject(
    id: string,
    rejectionReason?: string,
    rejectAllOverlays?: boolean,
  ): Promise<ApprovalResult> {
    return setProjectStatus(id, "rejected", rejectionReason, rejectAllOverlays);
  }

  onMounted(() => {
    const user = authStore.user;
    if (!user) return;

    const isAdmin = user.role === "admin";
    const mapCountryCode = moderationStore.selectedCountryCode;
    const canAccessMapCountry =
      !user.moderatedCountries ||
      (mapCountryCode !== null && user.moderatedCountries.includes(mapCountryCode));

    if (mapCountryCode && (isAdmin || canAccessMapCountry)) {
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
