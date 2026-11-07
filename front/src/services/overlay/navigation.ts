import { LngLat } from "maplibre-gl";
import { t } from "@/locales";
import { mobileAwareFlyTo, mobileAwareFlyToBounds } from "@/services/core/mapNavigation";
import { useOverlayStore } from "@/stores/overlayStore";
import type { OverlayObject } from "@/types/index";
import { trpc } from "@/client";
import { openOverlayDetail, raiseSelectedOverlayWhenReady } from "@/services/overlay/selection";
import { getMarker } from "@/services/overlay/mapLayers";
import { getOverlayBounds } from "@/services/overlay/markers";
import { overlayWireToData } from "@/utils/typeFactories";
import { toastError } from "@/services/core/toast";
import { MAP_CONFIG, getEffectiveThreshold } from "@/constants/mapConstants";
import { useAuthStore } from "@/stores/authStore";

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

const overlayLoadRequests = new WeakMap<
  ReturnType<typeof useOverlayStore>,
  Map<string, Promise<OverlayObject>>
>();

async function fetchOverlay(overlayId: string): Promise<OverlayObject> {
  const store = useOverlayStore();
  const auth = useAuthStore();
  const epoch = auth.getSessionEpoch();
  const userId = auth.user?.id;
  const result = await trpc.overlay.getOverlay.query({ id: overlayId });
  if (epoch !== auth.getSessionEpoch() || userId !== auth.user?.id) {
    throw new Error(t("submission.overlayUnavailable"));
  }
  return store.ingestBackendOverlay(overlayWireToData(result));
}

export async function ensureOverlayLoaded(overlayId: string): Promise<OverlayObject> {
  const overlayStore = useOverlayStore();
  const existing = overlayStore.liveOverlays[overlayId];

  if (existing && overlayStore.hasFullOverlayData(overlayId)) return existing;

  let requests = overlayLoadRequests.get(overlayStore);
  if (!requests) {
    requests = new Map();
    overlayLoadRequests.set(overlayStore, requests);
  }
  const auth = useAuthStore();
  const requestKey = `${auth.getSessionEpoch()}/${auth.user?.id ?? ""}/${overlayId}`;
  const pendingRequest = requests.get(requestKey);
  if (pendingRequest) return pendingRequest;

  const request = fetchOverlay(overlayId);
  requests.set(requestKey, request);
  try {
    return await request;
  } finally {
    if (requests.get(requestKey) === request) {
      requests.delete(requestKey);
    }
  }
}

/**
 * Navigates to a specific overlay by ID (loads + selects + centers).
 */
export async function navigateToOverlay(overlayId: string): Promise<boolean> {
  await ensureOverlayLoaded(overlayId);
  return selectAndCenterOverlay(overlayId);
}

/**
 * Navigates to the overlay a pending replacement supersedes, toasting when it can't be reached.
 */
export async function viewOriginalOverlay(originalOverlayId: string): Promise<void> {
  try {
    const success = await navigateToOverlay(originalOverlayId);
    if (!success) {
      toastError(t("overlay.failedToNavigate"), t("overlay.navigationFailed"));
    }
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
