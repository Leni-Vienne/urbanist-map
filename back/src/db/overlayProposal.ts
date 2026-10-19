import type { OverlayCorners } from "@shared/validation/schemas";

interface OverlayProposal {
  caption?: string | null;
  corners?: OverlayCorners;
}

function isCorner(value: unknown): value is { lat: number; lng: number } {
  if (typeof value !== "object" || value === null) return false;
  return (
    "lat" in value &&
    "lng" in value &&
    typeof value.lat === "number" &&
    typeof value.lng === "number"
  );
}

// Input must already be scoped to the caller's own open requests. Missing fields mean unchanged;
// an explicit null caption means clear. An empty patch still represents an open legacy request.
export function buildOwnOverlayProposal(
  changes: { fieldName: string; newValue: unknown }[],
): OverlayProposal | undefined {
  if (changes.length === 0) return undefined;

  const proposal: OverlayProposal = {};
  const newCorners = changes.find((change) => change.fieldName === "corners")?.newValue;
  if (Array.isArray(newCorners) && newCorners.every(isCorner)) {
    proposal.corners = newCorners;
  }

  const caption = changes.find((change) => change.fieldName === "caption")?.newValue;
  if (caption !== undefined) {
    proposal.caption = caption === null ? null : String(caption);
  }
  return proposal;
}
