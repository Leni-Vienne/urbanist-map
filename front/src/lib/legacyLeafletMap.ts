import type { Map as LeafletMap } from "leaflet";
import { map } from "@/services/core/map";

/**
 * TEMPORARY MapLibre-migration shim (Phases 2-4). Overlays, DOM markers, popups, and shape
 * editing still call the Leaflet map API. The live map is now a maplibregl.Map, so these calls
 * throw at runtime; the owning features are feature-gated off until ported off Leaflet.
 * Delete this file (and its callers) once the Leaflet leaf code is gone in Phase 5.
 */
export function legacyLeafletMap(): LeafletMap {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
  return map.value as unknown as LeafletMap;
}
