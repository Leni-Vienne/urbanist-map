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

// Result types for approval operations
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

  function resetModerationLoaded() {
    moderationStore.resetModerationLoaded();
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
      rejectionReason?: string; // New parameter for rejection feedback
      rejectAllOverlays?: boolean; // New parameter for cascading rejection to overlays
    }) => Promise<{ success: boolean }>,
    handleReplacementConflicts?: boolean,
    rejectionReason?: string, // Pass rejection reason to API
    rejectAllOverlays?: boolean, // Pass cascade flag to API
  ): Promise<ApprovalResult> {
    // Find item by ID and validate existence
    const item = items.find((i) => i.id === id);
    if (!item) {
      return {
        success: false,
        error: "not_found",
        message: t(`moderation.${itemType}NotFound`),
      };
    }

    // Derive error messages from itemType and status
    const failureMessageKey =
      status === "approved"
        ? `moderation.${itemType}ApprovalFailed`
        : `moderation.${itemType}RejectionFailed`;

    // Use version-aware approval endpoint with error handling
    const result = await withErrorHandling(
      async () =>
        apiCall({
          id,
          expectedVersion: item.version,
          status,
          handleReplacementConflicts,
          rejectionReason, // Pass rejection reason to backend
          rejectAllOverlays, // Pass cascade flag to backend
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
      // Handle version conflicts - refresh data and return conflict info
      resetModerationLoaded();
      await fetchPendingSubmissions();
      return {
        success: false,
        error: "version_conflict",
        message: t(`moderation.${itemType}VersionConflict`),
      };
    }

    resetModerationLoaded();
    await fetchPendingSubmissions();

    return {
      success: true,
    };
  }

  // Helper function to set overlay approval status using the generic handler
  async function setOverlayStatus(
    id: string,
    status: "approved" | "rejected",
    handleReplacementConflicts?: boolean,
    rejectionReason?: string, // New parameter for rejection feedback
  ): Promise<ApprovalResult> {
    const overlayStore = useOverlayStore();
    const mapStore = useMapStore();

    // Get the overlay's replacesOverlayId before approval (for cleanup after)
    const overlay = overlays.value.find((o) => o.id === id);
    const replacesOverlayId = overlay?.replacesOverlayId;

    const result = await setApprovalStatus(
      id,
      status,
      "overlay",
      overlays.value,
      trpc.moderation.setOverlayApprovalStatusWithVersion.mutate,
      handleReplacementConflicts,
      rejectionReason, // Pass rejection reason through
    );

    // Update overlay status in overlay store if approval succeeded and overlay is currently rendered
    if (result.success) {
      const overlayObject = overlayStore.overlays[id];

      if (overlayObject) {
        // Update the status in the overlay store
        overlayStore.updateOverlay(id, { status });

        // Update marker tooltip to reflect new status
        updateMarkerTooltip(overlayObject);

        // Update all marker colors to reflect status changes
        updateOverlayMarkersColors(overlayStore.overlays, mapStore.mode);
      }

      // If this was a replacement overlay approval with conflict handling, remove the original and competing overlays from map
      if (status === "approved" && handleReplacementConflicts && replacesOverlayId) {
        // Remove the original overlay that was replaced
        removeOverlayFromMapAndStore(replacesOverlayId);

        // Remove competing replacement overlays from the map
        // Find all overlays that tried to replace the same original overlay
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

    // Sync moderation store country with map store country on mount
    // This ensures we don't use stale state from previous sessions
    // BUT only if the map store country is valid for this user
    const mapCountryCode = mapStore.selectedCountryCode;
    const canAccessMapCountry =
      !user.moderatedCountries ||
      (mapCountryCode && user.moderatedCountries.includes(mapCountryCode));

    if (mapCountryCode && canAccessMapCountry) {
      moderationStore.setSelectedCountryCode(mapCountryCode);
    }
    // If map country is null (global view), we preserve the existing moderation store selection
    // This allows users to return to their previous moderation context

    const isAdmin = user.role === "admin";
    const hasSelectedCountry = moderationStore.selectedCountryCode !== null;

    // Fetch if admin (no country needed) OR if country already selected
    if (isAdmin || hasSelectedCountry) {
      await fetchPendingSubmissions();
    }
  });

  // Helper function to set project approval status using the generic handler
  async function setProjectStatus(
    id: string,
    status: "approved" | "rejected",
    rejectionReason?: string, // New parameter for rejection feedback
    rejectAllOverlays?: boolean, // New parameter for cascading rejection
  ): Promise<ApprovalResult> {
    const mapStore = useMapStore();

    // Get project data BEFORE approval (it will be removed from pending list after)
    const projectBeforeApproval = projects.value.find((p) => p.id === id);

    const result = await setApprovalStatus(
      id,
      status,
      "project",
      projects.value,
      trpc.moderation.setProjectApprovalStatusWithVersion.mutate,
      undefined, // HandleReplacementConflicts not used for projects
      rejectionReason, // Pass rejection reason through
      rejectAllOverlays, // Pass cascade flag through
    );

    // Update marker visuals if project approval succeeded and project has a standalone marker
    if (result.success && projectBeforeApproval) {
      // Update marker color to reflect new status (pending -> approved/rejected)
      // Use unknown as intermediate type since moderation project may not have all Project fields
      const projectWithNewStatus = createProjectObject({
        ...projectBeforeApproval,
        status,
      } as unknown as Partial<Project>);
      updateStandaloneProjectMarkerColor(id, projectWithNewStatus);

      // Update marker tooltip to reflect new status
      const marker = getStandaloneProjectMarkerByProjectId(id);
      if (marker) {
        updateStandaloneProjectMarkerTooltip(marker, projectWithNewStatus, mapStore.mode);
      }

      // Invalidate city cache to prevent stale data when reloading the city
      // This ensures the next city load fetches fresh data from backend with updated status
      if (projectBeforeApproval.cityId) {
        mapStore.clearCityStandaloneProjectsCache(projectBeforeApproval.cityId, mapStore.mode);
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
    overlays,
    projects,
    changeRequests,
    approveOverlay,
    rejectOverlay,
    approveProject,
    rejectProject,
    resetModerationLoaded,
    fetchPendingSubmissions,
  };
}
