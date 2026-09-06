import { useChangeRequestStore } from "@/stores/changeRequestStore";
import { useAuthStore } from "@/stores/authStore";
import { useProjectStore } from "@/stores/projectStore";

// Single boundary for the heavy shape-editing chunk (Terra Draw). The dynamic
// imports live here so every caller shares one split.

/**
 * Resolve the best available geometry to pre-load into the editor.
 *
 * Priority:
 * 1. An explicit geometry field in the local project draft.
 * 2. Pending change request geometry, the user's last submitted value (post page reload).
 * 3. Persisted project geometry.
 */
export function resolveShapeEditorGeometry(projectId: string): GeoJSON.GeometryCollection | null {
  const projectStore = useProjectStore();
  const authStore = useAuthStore();

  const draft = projectStore.projectDrafts[projectId];
  if (draft && "geometry" in draft) return draft.geometry ?? null;

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
  const pendingGeometry = pendingGeometryChange?.newValue as
    | GeoJSON.GeometryCollection
    | null
    | undefined;
  // oxlint-enable no-unsafe-type-assertion

  if (pendingGeometry !== undefined) return pendingGeometry;
  return projectStore.getPersistedProject(projectId)?.geometry ?? null;
}

/**
 * Resolve the best available geometry, then lazy-load the editor and start it.
 */
export async function startShapeEditing(projectId: string): Promise<void> {
  const existingGeometry = resolveShapeEditorGeometry(projectId);
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
