import { navigateToProject } from "@/services/navigation/projectNavigation";
import { mobileAwareFlyTo } from "@/services/core/mapNavigation";
import { navigateToOverlay } from "@/services/overlay/navigation";
import { useOverlayStore } from "@/stores/overlayStore";
import { useProjectStore } from "@/stores/projectStore";
import { useUiStore } from "@/stores/uiStore";
import { useModerationStore } from "@/stores/moderationStore";

import { t } from "@/locales";
import type { LatestContribution, ProjectPanelOverlay } from "@/types/index";
import { canModerateCountry } from "@/services/moderation/moderationCountrySync";
import { isValidQuad } from "@/services/overlay/transform";
import { toastWarn, toastError } from "@/services/core/toast";
import { openProjectDetailById } from "@/services/core/projectSelection";

// Union type to accept overlays from moderation and contributions panels
type NavigableOverlay = LatestContribution | ProjectPanelOverlay;

/** Navigate to an overlay, including rejected/replaced fallback and moderation access checks. */
export async function handleOverlayClickNavigation(overlay: NavigableOverlay): Promise<boolean> {
  try {
    const overlayStore = useOverlayStore();
    const uiStore = useUiStore();

    // For rejected or replaced overlays, navigate to overlay's centroid if available
    // Otherwise fall back to project center
    if ("status" in overlay && (overlay.status === "rejected" || overlay.status === "replaced")) {
      return navigateToReplacedOrRejectedOverlay(overlay, overlayStore);
    }

    // In moderation mode, auto-select the contribution's country for the moderation panel
    // If moderator doesn't have access to this country, block navigation with a toast
    const countryCode = "countryCode" in overlay ? overlay.countryCode : null;
    if (uiStore.mode === "moderation" && countryCode) {
      if (!canModerateCountry(countryCode)) {
        toastWarn(t("moderation.noAccessToThisCountry"), t("moderation.title"));
        return false;
      }
      // Auto-select the country so ModerationPanel loads its pending submissions
      useModerationStore().selectedCountryCode = countryCode;
    }

    return navigateToOverlay(overlay.id);
  } catch (error) {
    console.error("Failed to navigate to overlay:", error);
    toastError(
      error instanceof Error ? error.message : t("overlay.failedToNavigate"),
      t("location.navigationFailed"),
    );
    return false;
  }
}

/**
 * Navigate to a replaced or rejected overlay.
 * Tries to use the overlay centroid from the store, then falls back to the project centre.
 */
function navigateToReplacedOrRejectedOverlay(
  overlay: NavigableOverlay,
  overlayStore: ReturnType<typeof useOverlayStore>,
): boolean {
  if (!("projectId" in overlay) || !overlay.projectId) {
    return false;
  }
  const { projectId } = overlay;

  // First try to get centroid from overlay store (has full overlay data)
  const storeCorners = overlayStore.liveOverlays[overlay.id]?.baselineCorners;
  if (isValidQuad(storeCorners)) {
    const centroidLat = storeCorners.reduce((sum, c) => sum + c.lat, 0) / storeCorners.length;
    const centroidLng = storeCorners.reduce((sum, c) => sum + c.lng, 0) / storeCorners.length;

    mobileAwareFlyTo([centroidLat, centroidLng], 18);
    return true;
  }

  if (
    "lat" in overlay &&
    typeof overlay.lat === "number" &&
    "lng" in overlay &&
    typeof overlay.lng === "number"
  ) {
    navigateToProject(overlay.lat, overlay.lng, projectId);
    return true;
  }

  const project = useProjectStore().getProjectById(projectId);
  if (typeof project?.lat === "number" && typeof project.lng === "number") {
    navigateToProject(project.lat, project.lng, project.id);
    return true;
  }

  openProjectDetailById(projectId);
  return false;
}
