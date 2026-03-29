import {
  getPendingChangeRequests,
  refreshPendingChangeRequests,
} from "@/composables/changes/useChanges";
import { useAuthStore } from "@/stores/authStore";
import { useProjectStore } from "@/stores/pinia/projectStore";

/**
 * Resolves the best available geometry to pre-load into the shape editor.
 *
 * Priority:
 * 1. Local store geometry — reflects same-session edits.
 * 2. Pending change request geometry — the user's last submitted value (post page reload).
 * 3. fallbackGeometry — caller-supplied approved geometry from the backend.
 */
export async function resolveShapeEditorGeometry(
  projectId: string,
  fallbackGeometry: GeoJSON.GeometryCollection | null,
): Promise<GeoJSON.GeometryCollection | null> {
  await refreshPendingChangeRequests(true);

  const projectStore = useProjectStore();
  const authStore = useAuthStore();

  // Use undefined (not null) as "not found" sentinel so that an explicit null
  // (e.g. "delete all shapes") is preserved rather than falling through.
  const localStoredGeometry = projectStore.projects[projectId]?.geometry; // undefined if project absent, null if explicitly cleared
  const pendingGeometryChange = getPendingChangeRequests().find(
    (cr) =>
      cr.requestedBy === authStore.user?.id &&
      cr.entityType === "project" &&
      cr.entityId === projectId &&
      cr.fieldName === "geometry" &&
      cr.status === "pending",
  );
  // oxlint-disable no-unsafe-type-assertion
  const pendingGeometry = pendingGeometryChange
    ? (pendingGeometryChange.newValue as GeoJSON.GeometryCollection | null)
    : undefined;
  // oxlint-enable no-unsafe-type-assertion

  if (localStoredGeometry !== undefined) return localStoredGeometry;
  if (pendingGeometry !== undefined) return pendingGeometry;
  return fallbackGeometry;
}
