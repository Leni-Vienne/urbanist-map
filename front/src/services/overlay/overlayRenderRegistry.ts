// Centralized registry for all overlay layer references (image sources + markers).
// Single source of truth for "is this overlay rendered on the map?".
// Design principles:
//   - Pure map-layer lifecycle management, no Vue reactivity (not in Pinia)
//   - All creation goes through beginCreation(), atomically prevents duplicate layers
//   - clearAll() is the single cleanup path
import type { Marker as MaplibreMarker } from "maplibre-gl";
import { map } from "@/services/core/map";
import type { OverlayTransform } from "@/services/overlay/overlayTransform";

// MapLibre image-source state for one overlay.
export interface OverlayImageHandle {
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
    } else {
      entry.marker?.remove();
      entries.delete(id);
    }
  }
}

// eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
if (import.meta.hot) {
  import.meta.hot.accept();
}
