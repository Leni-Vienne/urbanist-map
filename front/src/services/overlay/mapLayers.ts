import { reactive } from "vue";
import type {
  Marker as MaplibreMarker,
  ImageSource,
  Map as MaplibreMap,
  PointLike,
} from "maplibre-gl";
import { getMap, getMapOrNull } from "@/services/core/map";
import {
  cornersToTransform,
  isValidQuad,
  transformToCorners,
  type OverlayTransform,
} from "@/services/overlay/transform";
import { useOverlayStore } from "@/stores/overlayStore";
import { MAP_CONFIG, getEffectiveThreshold } from "@/constants/mapConstants";
import type { OverlayObject, LatLng } from "@/types/index";

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
  // The imageUrl the source was created from. The reconciler swaps the source (crop / undo across a
  // crop) when the canonical store imageUrl no longer matches this.
  imageUrl: string;
}

interface RegistryEntry {
  marker: MaplibreMarker | null;
  imageHandle: OverlayImageHandle | null;
  // Store-derived corners most recently pushed to the image source. The reconciler diffs desired
  // corners against this (both store-derived) instead of reading back the float-unstable GL
  // transform. null until the first set/creation records one.
  lastAppliedCorners: LatLng[] | null;
}

const entries = new Map<string, RegistryEntry>();
// Tracks IDs currently being created.
// Internal to this module; callers use beginCreation/endCreation API.
const creating = new Set<string>();

// Overlays under an active pointer gesture (surface/corner drag, crop) own their GL position: the
// image is deliberately ahead of the store mid-gesture, so the reconciler must neither move nor
// destroy them until the gesture commits and releases. mapLayers is the shared leaf both the editor
// and the reconciler import, so ownership lives here rather than in editing.ts.
const gestureOwned = new Set<string>();

export function takeGestureOwnership(id: string): void {
  gestureOwned.add(id);
}

export function releaseGestureOwnership(id: string): void {
  gestureOwned.delete(id);
}

export function isGestureOwned(id: string): boolean {
  return gestureOwned.has(id);
}

// The reconciler moves an overlay's image, then the edit-handle outline/corner markers must follow.
// editing.ts registers its refresh here so the reconciler can call it without importing editing.ts
// (a cycle, since editing.ts imports the reconciler). No-op until an edit session registers; the
// refresh itself only acts on the currently-edited overlay.
let editHandleSync: (() => void) | null = null;

export function registerEditHandleSync(fn: () => void): () => void {
  editHandleSync = fn;

  return function unregisterEditHandleSync(): void {
    if (editHandleSync === fn) editHandleSync = null;
  };
}

export function runEditHandleSync(): void {
  editHandleSync?.();
}

// Store writers (sync.ts, editing.ts) that change an overlay's resolved position schedule a
// reconcile through this leaf rather than importing viewportRenderLoop directly: the loop
// dynamically imports rendering.ts, which imports sync.ts, so a direct edge would form a cycle.
// viewportRenderLoop registers its RAF-coalescing scheduler here on init.
let overlayReconcileScheduler: (() => void) | null = null;

export function registerOverlayReconcileScheduler(fn: () => void): () => void {
  overlayReconcileScheduler = fn;

  return function unregisterOverlayReconcileScheduler(): void {
    if (overlayReconcileScheduler === fn) overlayReconcileScheduler = null;
  };
}

export function scheduleOverlayReconcile(): void {
  overlayReconcileScheduler?.();
}

// ─── Creation mutex ───────────────────────────────────────────────────────────

/**
 * Atomically begin creation for an overlay.
 * Returns true if creation can proceed, false if:
 *   - Already being created (prevents duplicate async callbacks)
 *   - Already has a ready layer (prevents re-creation)
 * Callers MUST call endCreation() once creation settles, on every success and failure path.
 */
export function beginCreation(id: string): boolean {
  if (creating.has(id)) return false;
  const entry = entries.get(id);
  if (entry !== undefined && entry.imageHandle !== null) return false;
  creating.add(id);
  return true;
}

// Release the creation mutex taken by beginCreation. Call on completion (success or failure).
export function endCreation(id: string): void {
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
    entries.set(id, { marker, imageHandle: null, lastAppliedCorners: null });
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
    entries.set(id, { marker: null, imageHandle: handle, lastAppliedCorners: null });
  }

  const waiters = imageReadyWaiters.get(id);
  if (waiters) {
    // Each fire() detaches its own waiter via cleanup(); deleting the current element mid-iteration
    // is well-defined for a Set, so no snapshot copy is needed.
    for (const waiter of waiters) waiter.fire();
  }
}

// ─── Image-ready notifications ─────────────────────────────────────────────────
// The viewport loop creates an overlay's image layer asynchronously after a camera move, so
// callers that act on a freshly-rendered overlay (auto-select, selection visuals, toolbar anchor)
// wait for it here. setImageHandle is the single point where a layer comes online.
interface ImageReadyWaiter {
  fire: () => void;
  cancel: () => void;
}

const imageReadyWaiters = new Map<string, Set<ImageReadyWaiter>>();

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
      waiters.delete(waiter);
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

  const waiter: ImageReadyWaiter = { fire, cancel };

  if (hasReadyLayer(id)) {
    fire();
    return cancel;
  }

  let waiters = imageReadyWaiters.get(id);
  if (!waiters) {
    waiters = new Set();
    imageReadyWaiters.set(id, waiters);
  }
  waiters.add(waiter);

  if (options.timeoutMs !== undefined) {
    timer = setTimeout(onExpire, options.timeoutMs);
  }

  return cancel;
}

// Detach every pending waiter and clear its timeout. Their overlay's image layer is never going to
// come online on the map they were registered against.
function cancelImageReadyWaiters(): void {
  for (const waiters of [...imageReadyWaiters.values()]) {
    for (const waiter of [...waiters]) waiter.cancel();
  }
  imageReadyWaiters.clear();
}

export function getImageHandle(id: string): OverlayImageHandle | null {
  return entries.get(id)?.imageHandle ?? null;
}

// IDs of overlays currently rendered as MapLibre image layers.
export function getRenderedOverlayIds(): string[] {
  const ids: string[] = [];
  for (const [id, entry] of entries) {
    if (entry.imageHandle !== null) ids.push(id);
  }
  return ids;
}

// IDs of every overlay holding a registry entry (image layer, DOM marker, or both).
// The viewport render loop sweeps these so entries no live set covers get destroyed.
export function getEntryIds(): string[] {
  return [...entries.keys()];
}

// setStyle() (satellite switch) wipes every source and layer, including overlay image
// sources, but leaves DOM markers untouched. Drops the now-dangling image handles so they are
// re-created once the new style loads. No map removal needed here.
export function dropImageHandlesForStyleSwitch(): void {
  for (const [id, entry] of entries) {
    entry.imageHandle = null;
    if (entry.marker === null) {
      entries.delete(id);
    }
  }
}

// Remove an overlay's image source + raster layer from the MapLibre map. Entries can outlive the
// map (sign-out on a non-map route), and a removed map took its sources and layers with it.
function removeImageFromMap(handle: OverlayImageHandle): void {
  const mlMap = getMapOrNull();
  if (!mlMap) return;
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
 * @param preserveMarkers - If true, only remove the image layers and keep the marker refs +
 *                          markers on the map, so the pins don't flicker while the images are
 *                          re-created. If false (default, full reset), remove both.
 */
export function clearAll(preserveMarkers = false): void {
  creating.clear();

  for (const [id, entry] of entries) {
    if (entry.imageHandle) {
      removeImageFromMap(entry.imageHandle);
    }

    if (preserveMarkers) {
      entry.imageHandle = null;
      if (entry.marker === null) entries.delete(id);
    } else {
      entry.marker?.remove();
      entries.delete(id);
    }
  }
}

// Per-overlay display choices (front/back pinning, opacity) and pending image-ready waiters. Held
// off the entry lifecycle so they survive handle re-creation, so nothing above evicts them. Reset
// on sign-out to keep them from carrying one account's session state into the next.
export function clearOverlayDisplayPrefs(): void {
  frontOverlayIds.clear();
  overlayOpacities.clear();
  cancelImageReadyWaiters();
}

/**
 * Drop every map object and per-instance bookkeeping the registry holds, so nothing can refer to a
 * map that is about to be removed. Runs while the map is still alive. Display preferences survive:
 * they are user choices, not map objects.
 */
export function clearMapObjectRegistry(): void {
  clearAll(false);
  gestureOwned.clear();
  cancelImageReadyWaiters();
}

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
// re-creation (zoom threshold crossing, style switch, viewport re-entry). Reactive so UI state
// (front/back toggle) can be computed from it.
const frontOverlayIds = reactive(new Set<string>());

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
  const mlMap = getMap();
  const handle = getImageHandle(id);
  if (!handle || !mlMap.getLayer(handle.rasterLayerId)) return;
  raiseToBandTop(mlMap, handle.rasterLayerId, frontOverlayIds.has(id));
}

export function setOverlayInFront(id: string, front: boolean): void {
  if (front) frontOverlayIds.add(id);
  else frontOverlayIds.delete(id);

  const mlMap = getMap();
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
  const mlMap = getMap();
  const corners = getOverlayImageCorners(id);
  if (!corners) return false;

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
function cornersToImageCoordinates(corners: LatLng[]): ImageCoordinates {
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
  return getMap().getSource<ImageSource>(sourceId);
}

// Add an image source + raster layer for one overlay. The raster layer's minzoom hides the image
// below the zoom threshold natively.
export function createOverlayImage(
  overlayObject: OverlayObject,
  corners: LatLng[],
): OverlayImageHandle | null {
  const mlMap = getMap();
  if (!isValidQuad(corners)) return null;

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

  return {
    sourceId,
    rasterLayerId,
    transform: cornersToTransform(corners),
    opacity,
    imageUrl: overlayObject.imageUrl,
  };
}

// Record the store-derived corners just pushed to the image source (creation, position restore,
// image swap). The raw gesture path (setOverlayImageTransform) deliberately does NOT record: the
// reconciler compares desired corners against the last store-applied ones, never against a gesture.
export function recordAppliedCorners(id: string, corners: LatLng[]): void {
  const entry = entries.get(id);
  if (entry) entry.lastAppliedCorners = corners;
}

export function getLastAppliedCorners(id: string): LatLng[] | null {
  return entries.get(id)?.lastAppliedCorners ?? null;
}

// Re-render the image at exactly these corners (display / non-edit, e.g. restoring a saved
// position). Also refreshes the stored rigid transform so the next edit starts from here.
export function setOverlayImageCorners(id: string, corners: LatLng[]): void {
  const handle = getImageHandle(id);
  if (!handle || !isValidQuad(corners)) return;
  getImageSource(handle.sourceId)?.setCoordinates(cornersToImageCoordinates(corners));
  handle.transform = cornersToTransform(corners);
  recordAppliedCorners(id, corners);
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

// Derive an overlay's filename from its image URL: local data-URI uploads get a synthetic
// `pending-<id>.webp` name, backend URLs keep their last path segment.
export function deriveOverlayFilename(id: string, imageUrl: string, fallback = ""): string {
  return imageUrl.startsWith("data:")
    ? `pending-${id}.webp`
    : (imageUrl.split("/").pop() ?? fallback);
}

// Swap an overlay's image bytes (and footprint) on the map: tear down the existing source/layer
// and rebuild it from a new imageUrl at the given corners. Used when an edit changes the pixels
// (crop apply, or undo/redo stepping across a crop), not just the position. Opacity and front/back
// order are keyed by overlay id and so survive the rebuild.
export function replaceOverlayImageSource(id: string, imageUrl: string, corners: LatLng[]): void {
  const mlMap = getMap();
  const handle = getImageHandle(id);
  if (handle) {
    if (mlMap.getLayer(handle.rasterLayerId)) mlMap.removeLayer(handle.rasterLayerId);
    if (mlMap.getSource(handle.sourceId)) mlMap.removeSource(handle.sourceId);
  }

  const store = useOverlayStore();
  const overlay = store.liveOverlays[id];
  if (!overlay) return;

  const filename = deriveOverlayFilename(id, imageUrl, overlay.filename);

  store.updateOverlay(id, { imageUrl, filename });

  const newHandle = createOverlayImage(overlay, corners);
  if (newHandle) {
    setImageHandle(id, newHandle);
    recordAppliedCorners(id, corners);
  }
}

// Last edited corner set from history, or null. Fallback for when the image handle is
// temporarily null (e.g. zoomed out past the overlay threshold) but the overlay is modified.
function lastHistoryCorners(id: string): LatLng[] | null {
  const overlay = useOverlayStore().liveOverlays[id];
  const lastCorners = overlay?.history.at(-1)?.corners;
  return lastCorners ?? null;
}

// Live rigid transform of the overlay: from the image handle when rendered, else rebuilt from
// the last history entry.
export function getCurrentTransform(id: string): OverlayTransform | null {
  const handle = getImageHandle(id);
  if (handle) return handle.transform;
  const corners = lastHistoryCorners(id);
  return corners ? cornersToTransform(corners) : null;
}

// Corners of the rendered GL image, or null when the overlay's raster is not on the map.
export function getRenderedOverlayCorners(id: string): LatLng[] | null {
  const handle = getImageHandle(id);
  return handle ? transformToCorners(handle.transform) : null;
}

// Live corners of the overlay's current rigid transform: from the rendered image when present,
// else the last history entry. The edited position during editing.
export function getOverlayImageCorners(id: string): LatLng[] | null {
  return getRenderedOverlayCorners(id) ?? lastHistoryCorners(id);
}

// Set raster opacity (0..1) for one overlay, persisting it on the handle.
export function setOverlayImageOpacity(id: string, opacity: number): void {
  overlayOpacities.set(id, opacity);
  const mlMap = getMap();
  const handle = getImageHandle(id);
  if (!handle) return;
  handle.opacity = opacity;
  if (mlMap.getLayer(handle.rasterLayerId)) {
    mlMap.setPaintProperty(handle.rasterLayerId, "raster-opacity", opacity);
  }
}
