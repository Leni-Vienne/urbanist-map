import { computed, onMounted } from "vue";
import { trpc } from "@/client";
import { withErrorHandling } from "@/services/core/errorHandling";
import { useToast } from "@/composables/ui/useToast";
import { useModerationStore } from "@/stores/pinia/moderationStore";
import { useOverlayStore } from "@/stores/pinia/overlayStore";
import { useMapStore } from "@/stores/pinia/mapStore";
import { useAuthStore } from "@/stores/authStore";
import { updateMarkerTooltip } from "@/services/overlay/overlayMarkers";
import { updateOverlayMarkersColors } from "@/services/map/markers";
import { removeOverlayFromMapAndStore } from "@/services/core/entityRemoval";
import {
  getStandaloneProjectMarkerByProjectId,
  updateStandaloneProjectMarkerTooltip,
  updateStandaloneProjectMarkerColor,
} from "@/services/map/standaloneProjectMarkers";
import { t } from "@/locales";
import type { Project } from "@/types/index";
import { createProjectObject } from "@/utils/typeFactories";

// Result type for approval operations
type ApprovalResult = {
  success: boolean;
  error?: "not_found" | "version_conflict" | "unknown";
  message?: string;
};

export function useModeration() {
  const moderationStore = useModerationStore();
  const toast = useToast();

  const overlays = computed(() => moderationStore.overlays);
  const projects = computed(() => moderationStore.projects);
  const changeRequests = computed(() => moderationStore.changeRequests);

  async function fetchPendingSubmissions() {
    if (moderationStore.moderationLoaded) {
      return;
    }

    try {
      // Pass selected country code for country-scoped moderation
      const response = await trpc.moderation.getPendingSubmissions.query({
        countryCode: moderationStore.selectedCountryCode ?? undefined,
      });

      moderationStore.setModerationData({
        overlays: response.overlays,
        projects: response.projects,
        changeRequests: response.changeRequests,
      });
    } catch (error) {
      // If error is because no country is selected, don't show error toast (UI will prompt user to select)
      if (error instanceof Error && error.message.includes("must select a country")) {
        console.log("Waiting for country selection before loading moderation data");
      } else {
        console.error("Failed to load pending submissions:", error);
        toast.add({
          severity: "error",
          summary: t("common.error"),
          detail: t("moderation.fetchSubmissionsFailed"),
          life: 5000,
        });
      }
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

    if (!result.success) {
      moderationStore.resetModerationLoaded();
      await fetchPendingSubmissions();
      return {
        success: false,
        error: "version_conflict",
        message: t(`moderation.${itemType}VersionConflict`),
      };
    }

    moderationStore.resetModerationLoaded();
    await fetchPendingSubmissions();

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
    const mapStore = useMapStore();

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
        overlayStore.updateOverlay(id, { status });
        updateMarkerTooltip(overlayObject);
        updateOverlayMarkersColors(overlayStore.overlays, mapStore.mode);
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
    const mapStore = useMapStore();
    const user = authStore.user;

    if (!user) return;

    const mapCountryCode = mapStore.selectedCountryCode;
    const canAccessMapCountry =
      !user.moderatedCountries ||
      (mapCountryCode && user.moderatedCountries.includes(mapCountryCode));

    if (mapCountryCode && canAccessMapCountry) {
      moderationStore.setSelectedCountryCode(mapCountryCode);
    }
    // Preserve the existing moderation store country if the map is in global view

    const isAdmin = user.role === "admin";
    const hasSelectedCountry = moderationStore.selectedCountryCode !== null;

    // Fetch if admin (no country needed) OR if country already selected
    if (isAdmin || hasSelectedCountry) {
      await fetchPendingSubmissions();
    }
  });

  async function setProjectStatus(
    id: string,
    status: "approved" | "rejected",
    rejectionReason?: string,
    rejectAllOverlays?: boolean,
  ): Promise<ApprovalResult> {
    const mapStore = useMapStore();

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
