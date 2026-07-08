// The last-synced set of approved overlays built from overlay-footprint tile features, keyed by id.
// vectorTileSync writes it (filters + viewport already applied); the viewport reconciler reads it
// as the desired-existence signal for approved overlays, and shape rendering reads it to collect
// approved-overlay project ids. Held here as a leaf so the writer (tiles/sync) can depend on the
// reconciler without a cycle through the reader.

import type { OverlayData } from "@/types/index";

const approvedOverlayDataCache = new Map<string, OverlayData>();

// Current snapshot of approved overlay data built from tile features. Only includes overlays whose
// resolved image position currently intersects the viewport (baseline footprint or an open change
// request's suggested position).
export function getApprovedOverlayDataFromTiles(): ReadonlyMap<string, OverlayData> {
  return approvedOverlayDataCache;
}

// Replace the cache contents with the freshly-synced set (mutates in place so existing readers
// holding the ReadonlyMap reference see the update).
export function replaceApprovedOverlayDataCache(next: Map<string, OverlayData>): void {
  approvedOverlayDataCache.clear();
  for (const [id, data] of next) approvedOverlayDataCache.set(id, data);
}
