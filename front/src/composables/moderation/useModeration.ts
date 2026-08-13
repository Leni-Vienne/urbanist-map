import { computed, onMounted } from "vue";
import { trpc } from "@/client";
import { loadOrNull } from "@/services/core/errorHandling";

import { useModerationStore } from "@/stores/moderationStore";
import { useOverlayStore } from "@/stores/overlayStore";
import { useMapStore } from "@/stores/mapStore";
import { useAuthStore } from "@/stores/authStore";
import { removeOverlayFromMapAndStore } from "@/services/entity/entityRemoval";
import { refreshMapSessionData } from "@/services/map/viewportTriggers";
import { t } from "@/locales";
import type { Project } from "@/types/index";
import { toastError } from "@/services/core/toast";

// Result type for approval operations
type ApprovalResult = {
  success: boolean;
  error?: "not_found" | "version_conflict" | "unknown";
  message?: string;
};

export function useModeration() {
  const moderationStore = useModerationStore();
  const mapStore = useMapStore();

  const overlays = computed(() => moderationStore.overlays);
  const projects = computed(() => moderationStore.projects);
  const changeRequests = computed(() => moderationStore.changeRequests);

  async function fetchPendingSubmissions() {
    if (moderationStore.moderationLoaded) {
      return;
    }

    try {
      const response = await trpc.moderation.getPendingSubmissions.query({
        countryCode: mapStore.selectedCountryCode ?? undefined,
      });

      // The moderation backend query omits the derived overlayIds array and the parsed geometry.
      // Coerce here so the stored projects satisfy Project.
      const moderationProjects: Project[] = response.projects.map((project) => ({
        ...project,
        overlayIds: project.overlays.map((overlay) => overlay.id),
        geometry: null,
        tags: project.tags ?? [],
      }));

      moderationStore.setModerationData({
        overlays: response.overlays,
        projects: moderationProjects,
        changeRequests: response.changeRequests,
      });
    } catch (error) {
      // No country selected yet: stay silent, the UI prompts the user to pick one.
      if (error instanceof Error && error.message.includes("must select a country")) {
        return;
      }
      console.error("Failed to load pending submissions:", error);
      toastError(t("moderation.fetchSubmissionsFailed"));
    }
  }

  // Generic approval handler for any moderation item type
  async function setApprovalStatus(
    id: string,
    status: "approved" | "rejected",
    itemType: "overlay" | "project",
    items: { id: string; version: number }[],
    apiCall: (params: {
      id: string;
      expectedVersion: number;
      status: "approved" | "rejected";
      handleReplacementConflicts?: boolean;
      rejectionReason?: string;
      rejectAllOverlays?: boolean;
    }) => Promise<{ success: boolean }>,
    handleReplacementConflicts?: boolean,
    rejectionReason?: string,
    rejectAllOverlays?: boolean,
  ): Promise<ApprovalResult> {
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

    const result = await loadOrNull(
      async () =>
        apiCall({
          id,
          expectedVersion: item.version,
          status,
          handleReplacementConflicts,
          rejectionReason,
          rejectAllOverlays,
        }),
      { errorMessage: `${t(failureMessageKey)}. Please try again.` },
    );

    if (!result) {
      return {
        success: false,
        error: "unknown",
        message: t(failureMessageKey),
      };
    }

    // Refetch so the panel reflects the new server state, whether the write
    // succeeded or hit a version conflict.
    moderationStore.resetModerationLoaded();
    await fetchPendingSubmissions();

    if (!result.success) {
      return {
        success: false,
        error: "version_conflict",
        message: t(`moderation.${itemType}VersionConflict`),
      };
    }

    // Drop the just-actioned item from the moderation map set.
    await refreshMapSessionData();

    return {
      success: true,
    };
  }

  async function setOverlayStatus(
    id: string,
    status: "approved" | "rejected",
    handleReplacementConflicts?: boolean,
    rejectionReason?: string,
  ): Promise<ApprovalResult> {
    const overlayStore = useOverlayStore();

    const overlay = overlays.value.find((o) => o.id === id);
    const replacesOverlayId = overlay?.replacesOverlayId;

    const result = await setApprovalStatus(
      id,
      status,
      "overlay",
      overlays.value,
      trpc.moderation.setOverlayApprovalStatusWithVersion.mutate,
      handleReplacementConflicts,
      rejectionReason,
    );

    if (result.success) {
      const overlayObject = overlayStore.liveOverlays[id];

      if (overlayObject) {
        // updateOverlay mutates the Pinia proxy, picked up by the marker color watcher.
        overlayStore.updateOverlay(id, { status });
      }

      // If a replacement overlay was approved, remove the original and any competing replacements
      if (status === "approved" && handleReplacementConflicts && replacesOverlayId) {
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

  async function approveOverlay(
    id: string,
    handleReplacementConflicts?: boolean,
  ): Promise<ApprovalResult> {
    return setOverlayStatus(id, "approved", handleReplacementConflicts);
  }

  async function rejectOverlay(id: string, rejectionReason?: string): Promise<ApprovalResult> {
    return setOverlayStatus(id, "rejected", undefined, rejectionReason);
  }

  async function setProjectStatus(
    id: string,
    status: "approved" | "rejected",
    rejectionReason?: string,
    rejectAllOverlays?: boolean,
  ): Promise<ApprovalResult> {
    const result = await setApprovalStatus(
      id,
      status,
      "project",
      projects.value,
      trpc.moderation.setProjectApprovalStatusWithVersion.mutate,
      undefined,
      rejectionReason,
      rejectAllOverlays,
    );

    return result;
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
    const authStore = useAuthStore();
    const user = authStore.user;
    if (!user) return;

    const isAdmin = user.role === "admin";
    const mapCountryCode = mapStore.selectedCountryCode;
    const canAccessMapCountry =
      !user.moderatedCountries ||
      (mapCountryCode !== null && user.moderatedCountries.includes(mapCountryCode));

    // Admins fetch unfiltered; moderators only when the active country is one they can access.
    if (isAdmin || (mapCountryCode && canAccessMapCountry)) {
      void fetchPendingSubmissions();
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
