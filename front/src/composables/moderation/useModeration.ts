import { computed, onMounted } from "vue";
import { trpc } from "@/client";
import { withErrorHandling } from "@/services/core/errorHandling";
import { useToast } from "@/composables/ui/useToast";
import { useModerationStore } from "@/stores/pinia/moderationStore";
import { useOverlayStore } from "@/stores/pinia/overlayStore";
import { useMapStore } from "@/stores/pinia/mapStore";
import { useAuthStore } from "@/stores/authStore";
import { updateMarkerTooltip } from "@/services/overlay/overlayMarkers";
import { removeOverlayFromMapAndStore } from "@/services/core/entityRemoval";
import {
  getStandaloneProjectMarkerByProjectId,
  updateStandaloneProjectMarkerTooltip,
  updateStandaloneProjectMarkerColor,
} from "@/services/map/standaloneProjectMarkers";
import { t } from "@/locales";
import type { Project, ProjectForModeration } from "@/types/index";
import { createProjectObject } from "@/utils/typeFactories";

// Result type for approval operations
type ApprovalResult = {
  success: boolean;
  error?: "not_found" | "version_conflict" | "unknown";
  message?: string;
};

export function useModeration() {
  const moderationStore = useModerationStore();
  const mapStore = useMapStore();
  const toast = useToast();

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

      // The moderation backend query omits the joined city object, the derived overlayIds array,
      // and the parsed geometry. Coerce here so the stored projects satisfy ProjectForModeration.
      const moderationProjects: ProjectForModeration[] = response.projects.map((project) => ({
        ...project,
        city: null,
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
      toast.add({
        severity: "error",
        summary: t("common.error"),
        detail: t("moderation.fetchSubmissionsFailed"),
        life: 5000,
      });
    }
  }

  // Generic approval handler for any moderation item type
  async function setApprovalStatus(
    id: string,
    status: "approved" | "rejected",
    itemType: "overlay" | "project",
    items: { id: string; name?: string | null; version: number }[],
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

    const result = await withErrorHandling(
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
      const overlayObject = overlayStore.overlays[id];

      if (overlayObject) {
        // updateOverlay mutates the Pinia proxy, picked up by initializeMarkerColorTriggers.
        overlayStore.updateOverlay(id, { status });
        updateMarkerTooltip(overlayObject);
      }

      // If a replacement overlay was approved, remove the original and any competing replacements
      if (status === "approved" && handleReplacementConflicts && replacesOverlayId) {
        removeOverlayFromMapAndStore(replacesOverlayId);

        const competingReplacements = Object.values(overlayStore.overlays).filter(
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

  onMounted(async () => {
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
      await fetchPendingSubmissions();
    }
  });

  async function setProjectStatus(
    id: string,
    status: "approved" | "rejected",
    rejectionReason?: string,
    rejectAllOverlays?: boolean,
  ): Promise<ApprovalResult> {
    const projectBeforeApproval = projects.value.find((p) => p.id === id);

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

    if (result.success && projectBeforeApproval) {
      // oxlint-disable-next-line no-unsafe-type-assertion
      const projectWithNewStatus = createProjectObject({
        ...projectBeforeApproval,
        status,
      } as unknown as Partial<Project>);
      updateStandaloneProjectMarkerColor(id, projectWithNewStatus);

      const marker = getStandaloneProjectMarkerByProjectId(id);
      if (marker) {
        updateStandaloneProjectMarkerTooltip(marker, projectWithNewStatus, mapStore.mode);
      }
    }

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
