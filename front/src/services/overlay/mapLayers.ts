import type {
  Marker as MaplibreMarker,
  ImageSource,
  Map as MaplibreMap,
  PointLike,
} from "maplibre-gl";
import { map } from "@/services/core/map";
import {
  cornersToTransform,
  transformToCorners,
  type OverlayTransform,
} from "@/services/overlay/transform";
import { useOverlayStore } from "@/stores/overlayStore";
import { MAP_CONFIG, getEffectiveThreshold } from "@/constants/mapConstants";
import type { OverlayObject } from "@/types/index";

// Centralized registry for all overlay layer references (image sources + markers).
// Single source of truth for "is this overlay rendered on the map?".
// Design principles:
//   - Pure map-layer lifecycle management, no Vue reactivity (not in Pinia)
//   - All creation goes through beginCreation(), atomically prevents duplicate layers
//   - clearAll() is the single cleanup path
// MapLibre image-source state for one overlay.
interface OverlayImageHandle {
  sourceId: string;
  rasterLayerId: string;
  transform: OverlayTransform;
  opacity: number;
}

interface RegistryEntry {
  marker: MaplibreMarker | null;
  imageHandle: OverlayImageHandle | null;
}

const entries = new Map<string, RegistryEntry>();
// Tracks IDs currently being created.
// Internal to this module; callers use beginCreation/cancelCreation API.
const creating = new Set<string>();

// ─── Creation mutex ───────────────────────────────────────────────────────────

/**
 * Atomically begin creation for an overlay.
 * Returns true if creation can proceed, false if:
 *   - Already being created (prevents duplicate async callbacks)
 *   - Already has a ready layer (prevents re-creation)
 * Callers MUST call cancelCreation() on all failure paths.
 */
export function beginCreation(id: string): boolean {
  if (creating.has(id)) return false;
  const entry = entries.get(id);
  if (entry !== undefined && entry.imageHandle !== null) return false;
  creating.add(id);
  return true;
}

export function cancelCreation(id: string): void {
  creating.delete(id);
}

export function isCreating(id: string): boolean {
  return creating.has(id);
}

export function hasReadyLayer(id: string): boolean {
  return (entries.get(id)?.imageHandle ?? null) !== null;
}

// ─── Marker ──────────────────────────────────────────────────────────────────

export function setMarker(id: string, marker: MaplibreMarker): void {
  const entry = entries.get(id);
  if (entry) {
    entry.marker = marker;
  } else {
    entries.set(id, { marker, imageHandle: null });
  }
}

export function getMarker(id: string): MaplibreMarker | null {
  return entries.get(id)?.marker ?? null;
}

// ─── Image handle (MapLibre image source) ────────────────────────────────────

export function setImageHandle(id: string, handle: OverlayImageHandle): void {
  const entry = entries.get(id);
  if (entry) {
    entry.imageHandle = handle;
  } else {
    entries.set(id, { marker: null, imageHandle: handle });
  }

  const waiters = imageReadyWaiters.get(id);
  if (waiters) {
    // Each fire() detaches its own waiter via cleanup(); deleting the current element mid-iteration
    // is well-defined for a Set, so no snapshot copy is needed.
    for (const fire of waiters) fire();
  }
}

// ─── Image-ready notifications ─────────────────────────────────────────────────
// The viewport loop creates an overlay's image layer asynchronously after a camera move, so
// callers that act on a freshly-rendered overlay (auto-select, selection visuals, toolbar anchor)
// wait for it here. setImageHandle is the single point where a layer comes online.
const imageReadyWaiters = new Map<string, Set<() => void>>();

/**
 * Run `onReady` once the overlay's image layer is ready: immediately if it already is, otherwise
 * when setImageHandle next registers it. The callback always runs on a microtask, never inline
 * inside setImageHandle, because the render loop registers the handle before it commits the
 * overlay to the store. A `timeoutMs` may be given for overlays that might never render (e.g. one
 * that stays outside the viewport); `onTimeout` fires instead in that case. Returns a cancel
 * function; calling it before the callback fires detaches the waiter.
 */
export function whenImageReady(
  id: string,
  onReady: () => void,
  options: { timeoutMs?: number; onTimeout?: () => void } = {},
): () => void {
  let settled = false;
  let timer: ReturnType<typeof setTimeout> | undefined = undefined;

  function cleanup(): void {
    const waiters = imageReadyWaiters.get(id);
    if (waiters) {
      waiters.delete(fire);
      if (waiters.size === 0) imageReadyWaiters.delete(id);
    }
    if (timer !== undefined) clearTimeout(timer);
  }

  function fire(): void {
    if (settled) return;
    settled = true;
    cleanup();
    queueMicrotask(onReady);
  }

  function cancel(): void {
    if (settled) return;
    settled = true;
    cleanup();
  }

  function onExpire(): void {
    if (settled) return;
    settled = true;
    cleanup();
    options.onTimeout?.();
  }

  if (hasReadyLayer(id)) {
    fire();
    return cancel;
  }

  let waiters = imageReadyWaiters.get(id);
  if (!waiters) {
    waiters = new Set();
    imageReadyWaiters.set(id, waiters);
  }
  waiters.add(fire);

  if (options.timeoutMs !== undefined) {
    timer = setTimeout(onExpire, options.timeoutMs);
  }

  return cancel;
}

export function getImageHandle(id: string): OverlayImageHandle | null {
  return entries.get(id)?.imageHandle ?? null;
}

// IDs of overlays currently rendered as MapLibre image layers. Used by vectorTileSync to
// evict approved overlays that have left the rendered tile feature set.
export function getRenderedOverlayIds(): string[] {
  const ids: string[] = [];
  for (const [id, entry] of entries) {
    if (entry.imageHandle !== null) ids.push(id);
  }
  return ids;
}

// setStyle() (satellite switch) wipes every source and layer, including overlay image
// sources, but leaves DOM markers untouched. Drop the now-dangling image handles so
// vectorTileSync re-creates them once the new style loads. No map removal needed here.
export function dropImageHandlesForStyleSwitch(): void {
  for (const [id, entry] of entries) {
    entry.imageHandle = null;
    if (entry.marker === null) {
      entries.delete(id);
    }
  }
}

// Remove an overlay's image source + raster layer from the MapLibre map.
function removeImageFromMap(handle: OverlayImageHandle): void {
  const mlMap = map.value;
  if (mlMap.getLayer(handle.rasterLayerId)) mlMap.removeLayer(handle.rasterLayerId);
  if (mlMap.getSource(handle.sourceId)) mlMap.removeSource(handle.sourceId);
}

// ─── Full entry lifecycle ─────────────────────────────────────────────────────

/**
 * Remove a single overlay's layer and marker from the map and clear the entry.
 * Used for targeted cleanup (e.g. overlay deletion, viewport exit).
 */
export function clearEntry(id: string): void {
  const entry = entries.get(id);
  if (!entry) return;

  if (entry.imageHandle) {
    removeImageFromMap(entry.imageHandle);
  }
  entry.marker?.remove();

  entries.delete(id);
  creating.delete(id);
}

/**
 * Clear all entries from the registry.
 * @param preserveMarkers - If true (zoom threshold crossing), only remove image layers
 *                          and keep marker refs + markers on map.
 *                          If false (default, full reset), remove both layers and markers.
 */
export function clearAll(preserveMarkers = false): void {
  creating.clear();

  for (const [id, entry] of entries) {
    if (entry.imageHandle) {
      removeImageFromMap(entry.imageHandle);
    }

    if (preserveMarkers) {
      // Zoom threshold: null the image refs but keep the marker alive on the map.
      // This prevents marker flicker when crossing the zoom 13/14 boundary.
      entry.imageHandle = null;
      if (entry.marker === null) entries.delete(id);
    } else {
      entry.marker?.remove();
      entries.delete(id);
    }
  }
}

type Corner = { lat: number; lng: number };

function overlaySourceId(id: string): string {
  return `overlay-image-${id}`;
}

function overlayRasterLayerId(id: string): string {
  return `overlay-raster-${id}`;
}

type ImageCoordinates = [[number, number], [number, number], [number, number], [number, number]];

// Back rasters anchor just beneath the project geometry lines (project-shapes-*), which sit above
// the overlay-footprints outline/fill band. So a back image renders ABOVE every overlay footprint
// border (its own and neighbours'), preventing one overlay's border from cutting across another's
// image, while project geometry styling still draws on top of the image.
function getVectorLayersBottomId(mlMap: MaplibreMap): string | undefined {
  const anchor = mlMap.getStyle().layers.find((layer) => layer.id.startsWith("project-shapes"));
  return anchor?.id;
}

// Overlay IDs the user pinned to the front (above the geometry); otherwise inter-image order follows
// selection (clicked image rises to its band top). Held off the handle so the choice survives handle
// re-creation (zoom threshold crossing, style switch, viewport re-entry).
const frontOverlayIds = new Set<string>();

// Per-overlay raster opacity (0..1), held off the handle for the same reason. Absent = full opacity.
const overlayOpacities = new Map<string, number>();

export function isOverlayInFront(id: string): boolean {
  return frontOverlayIds.has(id);
}

// Front rasters move to the top of the stack; back rasters move just under the project geometry.
function raiseToBandTop(mlMap: MaplibreMap, rasterLayerId: string, front: boolean): void {
  if (front) {
    mlMap.moveLayer(rasterLayerId);
  } else {
    mlMap.moveLayer(rasterLayerId, getVectorLayersBottomId(mlMap));
  }
}

// Bring the selected overlay's image above all others in its band, so it can't stay hidden under a
// sibling the user is trying to work with.
export function raiseOverlayImage(id: string): void {
  const mlMap = map.value;
  const handle = getImageHandle(id);
  if (!handle || !mlMap.getLayer(handle.rasterLayerId)) return;
  raiseToBandTop(mlMap, handle.rasterLayerId, frontOverlayIds.has(id));
}

export function setOverlayInFront(id: string, front: boolean): void {
  if (front) frontOverlayIds.add(id);
  else frontOverlayIds.delete(id);

  const mlMap = map.value;
  const handle = getImageHandle(id);
  if (!handle || !mlMap.getLayer(handle.rasterLayerId)) return;
  raiseToBandTop(mlMap, handle.rasterLayerId, front);
}

// Project shape layers (lines + polygon fills) the overlay can sit over. The overlay's own
// footprint outline and the cluster points are deliberately excluded: only a real project shape
// makes the front/back toggle visually meaningful.
const PROJECT_SHAPE_QUERY_LAYERS = [
  "project-shapes-fill",
  "project-shapes-proposed-fill",
  "project-shapes",
  "project-shapes-completed",
  "project-shapes-proposed-dashed",
];

// True when the overlay's footprint overlaps a rendered project shape, so the front/back toggle
// would produce a visible change. Queries the screen-space bounding box of the (possibly rotated)
// footprint, which slightly over-covers, fine for gating a toolbar button.
export function overlayOverlapsProjectShape(id: string): boolean {
  const mlMap = map.value;
  const corners = getOverlayImageCorners(id);
  if (corners?.length !== 4) return false;

  const layers = PROJECT_SHAPE_QUERY_LAYERS.filter((layer) => mlMap.getLayer(layer));
  if (layers.length === 0) return false;

  const points = corners.map((c) => mlMap.project([c.lng, c.lat]));
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const bbox: [PointLike, PointLike] = [
    [Math.min(...xs), Math.min(...ys)],
    [Math.max(...xs), Math.max(...ys)],
  ];
  return mlMap.queryRenderedFeatures(bbox, { layers }).length > 0;
}

// MapLibre image sources take 4 corner coordinates in [TL, TR, BR, BL] order as [lng, lat].
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
  return map.value.getSource<ImageSource>(sourceId);
}

// Add an image source + raster layer for one overlay. The raster layer's minzoom replaces the
// old manual "show image past zoom X" plumbing; MapLibre hides it below the threshold natively.
export function createOverlayImage(
  overlayObject: OverlayObject,
  corners: Corner[],
): OverlayImageHandle | null {
  const mlMap = map.value;
  if (corners.length !== 4) return null;

  const sourceId = overlaySourceId(overlayObject.id);
  const rasterLayerId = overlayRasterLayerId(overlayObject.id);

  if (mlMap.getSource(sourceId)) return null;

  const opacity = overlayOpacities.get(overlayObject.id) ?? 1;

  try {
    mlMap.addSource(sourceId, {
      type: "image",
      url: overlayObject.imageUrl,
      coordinates: cornersToImageCoordinates(corners),
    });
    mlMap.addLayer(
      {
        id: rasterLayerId,
        type: "raster",
        source: sourceId,
        minzoom: getEffectiveThreshold(MAP_CONFIG.MIN_ZOOM_FOR_OVERLAYS),
        paint: { "raster-opacity": opacity, "raster-fade-duration": 0 },
      },
      frontOverlayIds.has(overlayObject.id) ? undefined : getVectorLayersBottomId(mlMap),
    );
  } catch (error) {
    console.error("Failed to create overlay image:", overlayObject.id, error);
    if (mlMap.getLayer(rasterLayerId)) mlMap.removeLayer(rasterLayerId);
    if (mlMap.getSource(sourceId)) mlMap.removeSource(sourceId);
    return null;
  }

  return { sourceId, rasterLayerId, transform: cornersToTransform(corners), opacity };
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
// the corner handles).
export function setOverlayImageTransform(id: string, transform: OverlayTransform): void {
  const handle = getImageHandle(id);
  if (!handle) return;
  handle.transform = transform;
  getImageSource(handle.sourceId)?.setCoordinates(
    cornersToImageCoordinates(transformToCorners(transform)),
  );
}

// Swap an overlay's image bytes (and footprint) on the map: tear down the existing source/layer
// and rebuild it from a new imageUrl at the given corners. Used when an edit changes the pixels
// (crop apply, or undo/redo stepping across a crop), not just the position. Opacity and front/back
// order are keyed by overlay id and so survive the rebuild.
export function replaceOverlayImageSource(id: string, imageUrl: string, corners: Corner[]): void {
  const mlMap = map.value;
  const handle = getImageHandle(id);
  if (handle) {
    if (mlMap.getLayer(handle.rasterLayerId)) mlMap.removeLayer(handle.rasterLayerId);
    if (mlMap.getSource(handle.sourceId)) mlMap.removeSource(handle.sourceId);
  }

  const store = useOverlayStore();
  const overlay = store.liveOverlays[id];
  if (!overlay) return;

  const filename = imageUrl.startsWith("data:")
    ? `pending-${id}.webp`
    : (imageUrl.split("/").pop() ?? overlay.filename);

  store.updateOverlay(id, { imageUrl, filename });

  const newHandle = createOverlayImage(overlay, corners);
  if (newHandle) setImageHandle(id, newHandle);
}

// Last edited corner set from history, or null. Fallback for when the image handle is
// temporarily null (e.g. zoomed out past the overlay threshold) but the overlay is modified.
function lastHistoryCorners(id: string): Corner[] | null {
  const overlay = useOverlayStore().liveOverlays[id];
  const lastCorners = overlay?.history.at(-1)?.corners;
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
  overlayOpacities.set(id, opacity);
  const mlMap = map.value;
  const handle = getImageHandle(id);
  if (!handle) return;
  handle.opacity = opacity;
  if (mlMap.getLayer(handle.rasterLayerId)) {
    mlMap.setPaintProperty(handle.rasterLayerId, "raster-opacity", opacity);
  }
}
