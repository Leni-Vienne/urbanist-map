import type { ImageSource } from "maplibre-gl";
import { map } from "@/services/core/map";
import {
  cornersToTransform,
  transformToCorners,
  type OverlayTransform,
} from "@/services/overlay/overlayTransform";
import { getImageHandle, type OverlayImageHandle } from "@/services/overlay/overlayRenderRegistry";
import { useOverlayStore } from "@/stores/pinia/overlayStore";
import { MAP_CONFIG, getEffectiveThreshold } from "@/constants/mapConstants";
import type { OverlayObject } from "@/types/index";

type Corner = { lat: number; lng: number };

function overlaySourceId(id: string): string {
  return `overlay-image-${id}`;
}

function overlayRasterLayerId(id: string): string {
  return `overlay-raster-${id}`;
}

type ImageCoordinates = [[number, number], [number, number], [number, number], [number, number]];

// MapLibre image sources warp to any 4-corner quad, so view mode renders the raw stored
// corners (pixel-exact for legacy skewed overlays). Order is [TL, TR, BR, BL] = [lng, lat].
function cornersToImageCoordinates(corners: Corner[]): ImageCoordinates {
  /* oxlint-disable no-non-null-assertion */
  return [
    [corners[0]!.lng, corners[0]!.lat],
    [corners[1]!.lng, corners[1]!.lat],
    [corners[2]!.lng, corners[2]!.lat],
    [corners[3]!.lng, corners[3]!.lat],
  ];
  /* oxlint-enable no-non-null-assertion */
}

function getImageSource(sourceId: string): ImageSource | undefined {
  return map.value?.getSource<ImageSource>(sourceId);
}

// Add an image source + raster layer for one overlay. The raster layer's minzoom replaces the
// old manual "show image past zoom X" plumbing; MapLibre hides it below the threshold natively.
export function createOverlayImage(
  overlayObject: OverlayObject,
  corners: Corner[],
): OverlayImageHandle | null {
  const mlMap = map.value;
  if (!mlMap || corners.length !== 4) return null;

  const sourceId = overlaySourceId(overlayObject.id);
  const rasterLayerId = overlayRasterLayerId(overlayObject.id);

  if (mlMap.getSource(sourceId)) return null;

  try {
    mlMap.addSource(sourceId, {
      type: "image",
      url: overlayObject.imageUrl,
      coordinates: cornersToImageCoordinates(corners),
    });
    mlMap.addLayer({
      id: rasterLayerId,
      type: "raster",
      source: sourceId,
      minzoom: getEffectiveThreshold(MAP_CONFIG.MIN_ZOOM_FOR_OVERLAYS),
      paint: { "raster-opacity": 1, "raster-fade-duration": 0 },
    });
  } catch (error) {
    console.error("Failed to create overlay image:", overlayObject.id, error);
    if (mlMap.getLayer(rasterLayerId)) mlMap.removeLayer(rasterLayerId);
    if (mlMap.getSource(sourceId)) mlMap.removeSource(sourceId);
    return null;
  }

  return { sourceId, rasterLayerId, transform: cornersToTransform(corners), opacity: 1 };
}

// Re-render the image at exactly these corners (display / non-edit, e.g. restoring a saved
// position). Also refreshes the stored rigid transform so the next edit starts from here.
export function setOverlayImageCorners(id: string, corners: Corner[]): void {
  const handle = getImageHandle(id);
  if (!handle || corners.length !== 4) return;
  getImageSource(handle.sourceId)?.setCoordinates(cornersToImageCoordinates(corners));
  handle.transform = cornersToTransform(corners);
}

// Re-render the image from the rigid transform (during editing; image corners line up with
// the corner handles). This is the rectifying path: skewed overlays snap to a rectangle.
export function setOverlayImageTransform(id: string, transform: OverlayTransform): void {
  const handle = getImageHandle(id);
  if (!handle) return;
  handle.transform = transform;
  getImageSource(handle.sourceId)?.setCoordinates(
    cornersToImageCoordinates(transformToCorners(transform)),
  );
}

// Last edited corner set from history, or null. Fallback for when the image handle is
// temporarily null (e.g. zoomed out past the overlay threshold) but the overlay is modified.
function lastHistoryCorners(id: string): Corner[] | null {
  const overlay = useOverlayStore().overlays[id];
  const lastCorners = overlay?.history?.at(-1);
  return lastCorners?.length === 4 ? lastCorners : null;
}

// Live rigid transform of the overlay: from the image handle when rendered, else rebuilt from
// the last history entry.
export function getCurrentTransform(id: string): OverlayTransform | null {
  const handle = getImageHandle(id);
  if (handle) return handle.transform;
  const corners = lastHistoryCorners(id);
  return corners ? cornersToTransform(corners) : null;
}

// Live corners of the overlay's current rigid transform. The edited position during editing.
export function getOverlayImageCorners(id: string): Corner[] | null {
  const handle = getImageHandle(id);
  if (handle) return transformToCorners(handle.transform);
  return lastHistoryCorners(id);
}

// Set raster opacity (0..1) for one overlay, persisting it on the handle.
export function setOverlayImageOpacity(id: string, opacity: number): void {
  const mlMap = map.value;
  const handle = getImageHandle(id);
  if (!mlMap || !handle) return;
  handle.opacity = opacity;
  if (mlMap.getLayer(handle.rasterLayerId)) {
    mlMap.setPaintProperty(handle.rasterLayerId, "raster-opacity", opacity);
  }
}

// Send one overlay's raster below all other overlay rasters (the toolbar "send to back").
export function sendOverlayImageToBack(id: string): void {
  const mlMap = map.value;
  const handle = getImageHandle(id);
  if (!mlMap || !handle) return;
  const layers = mlMap.getStyle().layers;
  const firstOverlayRaster = layers.find((layer) => layer.id.startsWith("overlay-raster-"));
  if (firstOverlayRaster && firstOverlayRaster.id !== handle.rasterLayerId) {
    mlMap.moveLayer(handle.rasterLayerId, firstOverlayRaster.id);
  }
}
