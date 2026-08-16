import { navigateToProject } from "@/services/navigation/projectNavigation";
import { mobileAwareFlyTo } from "@/services/core/mapNavigation";
import { navigateToOverlay } from "@/services/overlay/navigation";
import { useOverlayStore } from "@/stores/overlayStore";
import { useMapStore } from "@/stores/mapStore";

import { t } from "@/locales";
import { trpc } from "@/client";
import type { Overlay, LatestContribution } from "@/types/index";
import { canModerateCountry } from "@/services/moderation/moderationCountrySync";
import { loadOrNull } from "@/services/core/errorHandling";
import { isValidQuad } from "@/services/overlay/transform";
import { toastWarn, toastError } from "@/services/core/toast";

// Union type to accept overlays from moderation and contributions panels
type NavigableOverlay = Overlay | LatestContribution;

/** Navigate to an overlay, including rejected/replaced fallback and moderation access checks. */
export async function handleOverlayClickNavigation(overlay: NavigableOverlay): Promise<boolean> {
  try {
    const overlayStore = useOverlayStore();
    const mapStore = useMapStore();

    // For rejected or replaced overlays, navigate to overlay's centroid if available
    // Otherwise fall back to project center
    if ("status" in overlay && (overlay.status === "rejected" || overlay.status === "replaced")) {
      return navigateToReplacedOrRejectedOverlay(overlay, overlayStore);
    }

    // In moderation mode, auto-select the contribution's country for the moderation panel
    // If moderator doesn't have access to this country, block navigation with a toast
    if (mapStore.mode === "moderation" && overlay.countryCode) {
      if (!canModerateCountry(overlay.countryCode)) {
        toastWarn(t("moderation.noAccessToThisCountry"), t("moderation.title"));
        return false;
      }
      // Auto-select the country so ModerationPanel loads its pending submissions
      mapStore.setSelectedCountryCode(overlay.countryCode);
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
async function navigateToReplacedOrRejectedOverlay(
  overlay: NavigableOverlay,
  overlayStore: ReturnType<typeof useOverlayStore>,
): Promise<boolean> {
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

  const project = await loadOrNull(async () => trpc.project.getById.query({ id: projectId }), {
    errorMessage: t("overlay.failedToNavigate"),
  });

  if (project && typeof project.lat === "number" && typeof project.lng === "number") {
    navigateToProject(project.lat, project.lng, project.id);
    return true;
  }

  return false;
}
