// The last-synced set of approved overlays built from overlay-footprint tile features, keyed by id.
// Writes arrive with filters and the viewport already applied; readers treat it as the
// desired-existence signal for approved overlays. Held here as a leaf so the writer can depend on
// the viewport reconciler without a cycle through the reader.

import type { TileOverlayData } from "@/types/index";

const approvedOverlayDataCache = new Map<string, TileOverlayData>();

// Current snapshot of approved overlay data built from tile features. Only includes overlays whose
// resolved image position currently intersects the viewport (baseline footprint or an open change
// request's suggested position).
export function getApprovedOverlayDataFromTiles(): ReadonlyMap<string, TileOverlayData> {
  return approvedOverlayDataCache;
}

export function replaceApprovedOverlayDataCache(next: Map<string, TileOverlayData>): void {
  approvedOverlayDataCache.clear();
  for (const [id, data] of next) approvedOverlayDataCache.set(id, data);
}
