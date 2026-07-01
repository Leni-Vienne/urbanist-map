import { nextTick } from "vue";
import { navigateToProject } from "@/services/navigation/projectNavigation";
import { mobileAwareFlyTo } from "@/services/map/mapNavigation";
import { navigateToOverlay } from "@/services/overlay/actions";
import { useOverlayStore } from "@/stores/pinia/overlayStore";
import { useMapStore } from "@/stores/pinia/mapStore";
import { useToast } from "@/composables/ui/useToast";
import { t } from "@/locales";
import { trpc } from "@/client";
import type { Overlay, LatestContribution } from "@/types/index";
import {
  canModerateCountry,
  syncModerationCountry,
} from "@/services/moderation/moderationCountrySync";
import { loadOrNull } from "@/services/core/errorHandling";

// Union type to accept overlays from moderation and contributions panels
type NavigableOverlay = Overlay | LatestContribution;

/**
 * Shared composable for handling overlay clicks from moderation/contribution panels.
 */
export function useOverlayClickHandler() {
  const toast = useToast();

  /**
   * Navigate to an overlay, handling all necessary state changes.
   * Switches to edit mode when in view mode (required to see pending overlays).
   * In moderation mode, pending overlays are already visible so mode is kept.
   */
  async function handleOverlayClickNavigation(
    overlay: NavigableOverlay,
    shouldToggleEditMode = false,
    autoSelect = true,
  ): Promise<void> {
    try {
      const overlayStore = useOverlayStore();
      const mapStore = useMapStore();

      // For rejected or replaced overlays, navigate to overlay's centroid if available
      // Otherwise fall back to project center
      if ("status" in overlay && (overlay.status === "rejected" || overlay.status === "replaced")) {
        await navigateToReplacedOrRejectedOverlay(overlay, overlayStore);
        return;
      }

      // In moderation mode, auto-select the contribution's country for the moderation panel
      // If moderator doesn't have access to this country, block navigation with a toast
      if (mapStore.mode === "moderation" && overlay.countryCode) {
        if (!canModerateCountry(overlay.countryCode)) {
          toast.add({
            severity: "warn",
            summary: t("moderation.title"),
            detail: t("moderation.noAccessToThisCountry"),
            life: 4000,
          });
          return;
        }
        // Auto-select the country so ModerationPanel loads its pending submissions
        syncModerationCountry(overlay.countryCode);
      }

      // Only switch to edit mode if currently in view mode
      // In moderation mode, pending overlays are already visible, so don't switch
      if (mapStore.mode === "view" && shouldToggleEditMode) {
        mapStore.setMode("edit");

        // Only show toast for pending overlays (for approved ones it's less critical)
        if ("status" in overlay && overlay.status === "pending") {
          toast.add({
            severity: "info",
            summary: t("moderation.switchedToEditMode"),
            detail: t("moderation.pendingOverlaysOnlyInEditMode"),
            life: 3000,
          });
        }

        // Let the mode-change watchers run (they kick off overlay rendering) before navigating.
        // navigateToOverlay loads the overlay itself and tolerates async registration, so no
        // fixed delay is needed here.
        await nextTick();
      }

      await navigateToOverlay(overlay.id, autoSelect);
    } catch (error) {
      console.error("Failed to navigate to overlay:", error);
      toast.add({
        severity: "error",
        summary: t("location.navigationFailed"),
        detail: error instanceof Error ? error.message : t("overlay.failedToNavigate"),
        life: 3000,
      });
    }
  }

  return {
    handleOverlayClickNavigation,
  };
}

/**
 * Navigate to a replaced or rejected overlay.
 * Tries to use the overlay centroid from the store, then falls back to the project centre.
 */
async function navigateToReplacedOrRejectedOverlay(
  overlay: NavigableOverlay,
  overlayStore: ReturnType<typeof useOverlayStore>,
): Promise<void> {
  if (!("projectId" in overlay) || !overlay.projectId) {
    return;
  }
  const { projectId } = overlay;

  // First try to get centroid from overlay store (has full overlay data)
  const overlayFromStore = overlayStore.liveOverlays[overlay.id];
  if (overlayFromStore?.corners && overlayFromStore.corners.length >= 4) {
    // Calculate centroid from corners
    const centroidLat =
      overlayFromStore.corners.reduce((sum, c) => sum + c.lat, 0) / overlayFromStore.corners.length;
    const centroidLng =
      overlayFromStore.corners.reduce((sum, c) => sum + c.lng, 0) / overlayFromStore.corners.length;

    mobileAwareFlyTo([centroidLat, centroidLng], 18);
    return;
  }

  const project = await loadOrNull(async () => trpc.project.getById.query({ id: projectId }), {
    errorMessage: t("overlay.failedToNavigate"),
  });

  if (project && typeof project.lat === "number" && typeof project.lng === "number") {
    navigateToProject(project.lat, project.lng, project.id);
  }
}
