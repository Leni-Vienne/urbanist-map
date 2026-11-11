import { LngLat } from "maplibre-gl";
import { t } from "@/locales";
import { mobileAwareFlyTo, mobileAwareFlyToBounds } from "@/services/core/mapNavigation";
import { useOverlayStore } from "@/stores/overlayStore";
import type { OverlayObject } from "@/types/index";
import { openOverlayDetail, raiseSelectedOverlayWhenReady } from "@/services/overlay/selection";
import { getMarker } from "@/services/overlay/mapLayers";
import { getOverlayBounds } from "@/services/overlay/markers";
import { toastError } from "@/services/core/toast";
import { MAP_CONFIG, getEffectiveThreshold } from "@/constants/mapConstants";
import { useFocusStore } from "@/stores/focusStore";
import { useUiStore } from "@/stores/uiStore";
import { getMapOrNull } from "@/services/core/map";

// Helper to zoom to overlay bounds
function zoomToOverlayBounds(overlay: OverlayObject): void {
  // Try to get bounds from overlay data (works whether the image layer exists or not)
  const overlayBounds = getOverlayBounds(overlay);
  if (overlayBounds) {
    mobileAwareFlyToBounds(overlayBounds, {
      minZoom: getEffectiveThreshold(MAP_CONFIG.MIN_ZOOM_FOR_OVERLAYS),
      maxZoom: 18,
    });
    return;
  }

  // Fall back to marker position if bounds unavailable
  const marker = getMarker(overlay.id);
  if (marker) {
    const lngLat = marker.getLngLat();
    mobileAwareFlyTo(new LngLat(lngLat.lng, lngLat.lat), 17);
  }
}

export async function ensureOverlayLoaded(overlayId: string): Promise<OverlayObject> {
  const overlay = await useOverlayStore().loadOverlay(overlayId);
  if (!overlay) throw new Error(t("submission.overlayUnavailable"));
  return overlay;
}

/**
 * Navigates to a specific overlay by ID (loads + selects + centers).
 */
export async function navigateToOverlay(overlayId: string): Promise<boolean> {
  const isCurrent = useFocusStore().beginNavigation();
  const uiStore = useUiStore();
  const mode = uiStore.mode;
  const target = getMapOrNull();
  try {
    await ensureOverlayLoaded(overlayId);
  } catch (error) {
    if (!isCurrent() || getMapOrNull() !== target || uiStore.mode !== mode) return false;
    throw error;
  }
  if (!isCurrent() || !target || getMapOrNull() !== target || uiStore.mode !== mode) return false;
  return selectAndCenterOverlay(overlayId);
}

/**
 * Navigates to the overlay a pending replacement supersedes, toasting when it can't be reached.
 */
export async function viewOriginalOverlay(originalOverlayId: string): Promise<void> {
  try {
    await navigateToOverlay(originalOverlayId);
  } catch (error) {
    console.error("Failed to navigate to original overlay:", error);
    toastError(
      error instanceof Error ? error.message : t("overlay.failedToNavigate"),
      t("overlay.navigationFailed"),
    );
  }
}

function selectAndCenterOverlay(overlayId: string) {
  const overlayStore = useOverlayStore();

  const overlay = overlayStore.liveOverlays[overlayId];

  if (!overlay) {
    return false;
  }

  openOverlayDetail(overlayId);
  zoomToOverlayBounds(overlay);
  // When selecting from the side panel while zoomed out, the image layer isn't rendered yet, so
  // the initial raise no-ops. Re-raise once the flight renders it.
  raiseSelectedOverlayWhenReady(overlayId);

  return true;
}
