import { refreshPendingChangeRequests } from "@/composables/changes/useChanges";
import { useChangeRequestStore } from "@/stores/pinia/changeRequestStore";
import { useAuthStore } from "@/stores/authStore";
import { useProjectStore } from "@/stores/pinia/projectStore";

// Single boundary for the heavy shape-editing chunk (Terra Draw). The dynamic
// imports live here so every caller shares one split, same pattern as overlayRendering.

/**
 * Resolve the best available geometry to pre-load into the editor.
 *
 * Priority:
 * 1. Local store geometry, reflects same-session edits.
 * 2. Pending change request geometry, the user's last submitted value (post page reload).
 * 3. fallbackGeometry, caller-supplied approved geometry from the backend.
 */
async function resolveShapeEditorGeometry(
  projectId: string,
  fallbackGeometry: GeoJSON.GeometryCollection | null,
): Promise<GeoJSON.GeometryCollection | null> {
  await refreshPendingChangeRequests();

  const projectStore = useProjectStore();
  const authStore = useAuthStore();

  // Use undefined (not null) as sentinel: an explicit null means "delete all shapes"
  // and must be preserved rather than fallen through.
  const localStoredGeometry = projectStore.projects[projectId]?.geometry;
  const changeRequestStore = useChangeRequestStore();
  const pendingGeometryChange = changeRequestStore.pendingChangeRequests.find(
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

/**
 * Resolve the best available geometry, then lazy-load the editor and start it.
 */
export async function startShapeEditing(
  projectId: string,
  fallbackGeometry: GeoJSON.GeometryCollection | null,
): Promise<void> {
  const existingGeometry = await resolveShapeEditorGeometry(projectId, fallbackGeometry);
  const { initShapeEditor } = await import("@/services/shape/shapeEditing");
  await initShapeEditor(existingGeometry ?? undefined);
}

/**
 * Lazy-load the editor chunk and tear down any active editor.
 */
export async function stopShapeEditing(): Promise<void> {
  const { destroyShapeEditor } = await import("@/services/shape/shapeEditing");
  await destroyShapeEditor();
}
