// The last-synced set of approved overlays built from overlay-footprint tile features, keyed by id.
// Writes arrive with filters and the viewport already applied; readers treat it as the
// desired-existence signal for approved overlays. Held here as a leaf so the writer can depend on
// the viewport reconciler without a cycle through the reader.

import type { TileOverlayData } from "@/types/index";

const approvedOverlayDataCache = new Map<string, TileOverlayData>();
const filterRejectedOverlayIds = new Set<string>();

// Current snapshot of approved overlay data built from tile features. Only includes overlays whose
// resolved image position currently intersects the viewport (baseline footprint or an open change
// request's suggested position).
export function getApprovedOverlayDataFromTiles(): ReadonlyMap<string, TileOverlayData> {
  return approvedOverlayDataCache;
}

// Approved overlays the last sync saw in the tiles and a user filter rejected, whatever their
// position. Absence from the data cache alone does not mean "filtered out" (an overlay outside the
// viewport is also absent), so readers that resolve an overlay's data from another source consult
// this set to keep a rejected overlay off the map.
export function getFilterRejectedOverlayIds(): ReadonlySet<string> {
  return filterRejectedOverlayIds;
}

// Replace both snapshots with the freshly-synced sets (mutates in place so existing readers holding
// the ReadonlyMap/ReadonlySet reference see the update).
export function replaceApprovedOverlayDataCache(
  next: Map<string, TileOverlayData>,
  filterRejected: Set<string>,
): void {
  approvedOverlayDataCache.clear();
  for (const [id, data] of next) approvedOverlayDataCache.set(id, data);
  filterRejectedOverlayIds.clear();
  for (const id of filterRejected) filterRejectedOverlayIds.add(id);
}
