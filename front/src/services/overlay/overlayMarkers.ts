import { LngLat, LngLatBounds } from "maplibre-gl";
import maplibregl from "maplibre-gl";
import { map } from "@/services/core/map";
import {
  getOverlayMarkerColor,
  createOverlayMarkerElement,
  updateMarkerTooltip,
} from "@/services/map/markers";
import { mobileAwareFlyToBounds } from "@/services/map/mapNavigation";
import { useOverlayStore } from "@/stores/pinia/overlayStore";
import { useMapStore } from "@/stores/pinia/mapStore";
import { useAuthStore } from "@/stores/authStore";
import { isOverlayVisible } from "@/services/overlay/overlayVisibility";
import type { OverlayObject, OverlayData } from "@/types/index";
import * as registry from "@/services/overlay/overlayRenderRegistry";
import { getOverlayImageCorners } from "@/services/overlay/overlayImageLayer";
import {
  selectOverlay,
  highlightProject,
  removeProjectOutlines,
} from "@/services/overlay/overlaySelection";
import { syncPreviewStateOnNavigation } from "@/services/overlay/changeRequestPreviewState";
import { calculateCentroidFromCorners } from "@shared/overlayValidation";
import { enrichOverlayWithProject } from "@/services/overlay/overlayData";

type Corner = { lat: number; lng: number };

// Web Mercator is undefined beyond ~±85.06°. A corner that is finite but out of range (or
// otherwise malformed) projects to Infinity inside cameraForBounds and crashes the camera, so
// bad quads are rejected here before they reach marker placement or navigation.
const MAX_MERCATOR_LAT = 85.06;

function isValidCorner(c: Corner): boolean {
  return (
    Number.isFinite(c.lng) &&
    Number.isFinite(c.lat) &&
    Math.abs(c.lat) <= MAX_MERCATOR_LAT &&
    Math.abs(c.lng) <= 180
  );
}

function isValidQuad(corners: Corner[] | undefined | null): corners is Corner[] {
  return !!corners && corners.length === 4 && corners.every(isValidCorner);
}

/**
 * Resolve an overlay's current corners from the most accurate available source:
 *   0. live image position (most accurate while the overlay is rendered)
 *   1. edit-mode last-edited position from history (survives layer pruning when zooming)
 *   2. stored corners
 * Returns null when no source yields a valid 4-corner quad.
 */
function resolveOverlayCorners(overlay: OverlayData): Corner[] | null {
  const overlayStore = useOverlayStore();
  const mapStore = useMapStore();

  const liveCorners = getOverlayImageCorners(overlay.id);
  if (isValidQuad(liveCorners)) return liveCorners;

  if (mapStore.mode === "edit") {
    const lastEdited = overlayStore.overlays[overlay.id]?.history.at(-1);
    if (isValidQuad(lastEdited)) return lastEdited;
  }

  if (isValidQuad(overlay.corners)) return overlay.corners;

  return null;
}

/**
 * Create the marker for an overlay (edit / moderation modes). Idempotent: skips overlays that
 * already have a marker, are "replaced", or fail the mode/user visibility check.
 */
export function createOverlayMarker(overlay: OverlayObject): void {
  const mapStore = useMapStore();
  const mlMap = map.value;
  if (!mlMap) return;

  // The replacement sits at the same spot, so a marker for the replaced one would confuse.
  if (overlay.status === "replaced") return;
  if (registry.getMarker(overlay.id)) return;

  const authStore = useAuthStore();
  if (!isOverlayVisible(overlay, mapStore.mode, authStore.user?.id)) return;

  const corners = resolveOverlayCorners(overlay);
  if (!corners) return;

  const centroid = calculateCentroidFromCorners(corners);
  if (!centroid) return;

  const enriched = enrichOverlayWithProject(overlay);
  const markerColor = getOverlayMarkerColor(enriched, mapStore.mode);
  const element = createOverlayMarkerElement(markerColor);

  const marker = new maplibregl.Marker({ element, anchor: "bottom" })
    .setLngLat([centroid.lng, centroid.lat])
    .addTo(mlMap);

  element.addEventListener("click", (e) => {
    e.stopPropagation();
    onMarkerClick(overlay.id);
  });

  const projectId = overlay.projectId;
  if (projectId) {
    element.addEventListener("mouseenter", () => highlightProject(projectId));
    element.addEventListener("mouseleave", () => removeProjectOutlines(projectId));
  }

  registry.setMarker(overlay.id, marker);
  updateMarkerTooltip(enriched, markerColor);
}

// Selection + change-request preview + camera flight for a marker click. Selection runs first
// because it drives the toolbar and edit handles and must not depend on the camera, which can
// skip on degenerate bounds.
function onMarkerClick(overlayId: string): void {
  const overlayStore = useOverlayStore();
  const overlayObject = overlayStore.overlays[overlayId];
  if (!overlayObject) return;

  // Second click on the selected marker deselects.
  if (overlayStore.idSelectedOverlay === overlayId) {
    selectOverlay(null);
    return;
  }

  // Default to viewing the approved position on first click.
  overlayObject.isViewingApprovedPosition ??= true;
  syncPreviewStateOnNavigation(overlayId, overlayObject.isViewingApprovedPosition);

  selectOverlay(overlayId);

  const bounds = getOverlayBounds(overlayObject);
  if (bounds) mobileAwareFlyToBounds(bounds);
}

function buildBounds(corners: Corner[]): LngLatBounds {
  const bounds = new LngLatBounds();
  for (const c of corners) {
    bounds.extend(new LngLat(c.lng, c.lat));
  }
  return bounds;
}

/**
 * Bounds for an overlay, for camera navigation. Returns null when the overlay has no valid
 * geometry so callers skip navigation instead of feeding NaN bounds to the camera.
 */
export function getOverlayBounds(overlay: OverlayData): LngLatBounds | null {
  const corners = resolveOverlayCorners(overlay);
  return corners ? buildBounds(corners) : null;
}

// oxlint-disable-next-line @typescript-eslint/no-unnecessary-condition
if (import.meta.hot) {
  import.meta.hot.accept();
}
