// Centralized registry for all Leaflet layer references (image overlays + markers).
// This is the single source of truth for "is this overlay rendered on the map?".
// Replaces: overlaysBeingCreated Set, overlayStore.allMarkers, overlay.overlay field,
//           and overlay.marker field on OverlayObject.
//
// Design principles:
//   - Pure Leaflet lifecycle management, no Vue reactivity (not in Pinia)
//   - All creation goes through beginCreation() — atomically prevents duplicate layers
//   - clearAll() is the single cleanup path, replacing map.eachLayer() eachLayer sweeps
import type * as L from "leaflet";
import { map } from "@/services/core/map";

interface RegistryEntry {
  layer: L.DistortableImageOverlay | null;
  marker: L.Marker | null;
}

const entries = new Map<string, RegistryEntry>();
// Tracks IDs currently being created — replaces the exported overlaysBeingCreated Set.
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
  if (entry !== undefined && entry.layer !== null) return false;
  creating.add(id);
  return true;
}

export function cancelCreation(id: string): void {
  creating.delete(id);
}

export function isCreating(id: string): boolean {
  return creating.has(id);
}

// ─── Layer (DistortableImageOverlay) ─────────────────────────────────────────

export function setLayer(id: string, layer: L.DistortableImageOverlay): void {
  const entry = entries.get(id);
  if (entry) {
    entry.layer = layer;
  } else {
    entries.set(id, { layer, marker: null });
  }
}

export function getLayer(id: string): L.DistortableImageOverlay | null {
  return entries.get(id)?.layer ?? null;
}

export function hasReadyLayer(id: string): boolean {
  return (entries.get(id)?.layer ?? null) !== null;
}

/**
 * Null the layer reference without touching the marker.
 * Used after the Leaflet layer has already been removed from the map (zoom threshold).
 */
export function clearLayer(id: string): void {
  const entry = entries.get(id);
  if (entry) {
    entry.layer = null;
  }
}

// ─── Marker ──────────────────────────────────────────────────────────────────

export function setMarker(id: string, marker: L.Marker): void {
  const entry = entries.get(id);
  if (entry) {
    entry.marker = marker;
  } else {
    entries.set(id, { layer: null, marker });
  }
}

export function getMarker(id: string): L.Marker | null {
  return entries.get(id)?.marker ?? null;
}

// ─── Full entry lifecycle ─────────────────────────────────────────────────────

/**
 * Remove a single overlay's layer and marker from the Leaflet map and clear the entry.
 * Used for targeted cleanup (e.g. overlay deletion, viewport exit).
 */
export function clearEntry(id: string): void {
  const entry = entries.get(id);
  if (!entry) return;

  if (entry.layer && map.value.hasLayer(entry.layer)) {
    entry.layer.remove();
  }
  if (entry.marker && map.value.hasLayer(entry.marker)) {
    entry.marker.remove();
  }

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
    if (entry.layer && map.value.hasLayer(entry.layer)) {
      entry.layer.remove();
    }

    if (preserveMarkers) {
      // Zoom threshold: null the image layer but keep the marker alive on the map.
      // This prevents marker flicker when crossing the zoom 13/14 boundary.
      entry.layer = null;
    } else {
      if (entry.marker && map.value.hasLayer(entry.marker)) {
        entry.marker.remove();
      }
      entries.delete(id);
    }
  }
}

/**
 * Rename an entry (used when a local overlay gets a backend ID after submission).
 * The Leaflet layer and marker stay on the map — only the registry key changes.
 */
export function renameEntry(oldId: string, newId: string): void {
  const entry = entries.get(oldId);
  if (!entry) return;
  entries.delete(oldId);
  entries.set(newId, entry);
  if (creating.has(oldId)) {
    creating.delete(oldId);
    creating.add(newId);
  }
}

export function getAllLayers(): [string, L.DistortableImageOverlay][] {
  const result: [string, L.DistortableImageOverlay][] = [];
  for (const [id, entry] of entries) {
    if (entry.layer !== null) result.push([id, entry.layer]);
  }
  return result;
}

// eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
if (import.meta.hot) {
  import.meta.hot.accept();
}
