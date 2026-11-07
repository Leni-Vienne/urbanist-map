import { useChangeRequestStore } from "@/stores/changeRequestStore";
import { useAuthStore } from "@/stores/authStore";
import { useProjectStore } from "@/stores/projectStore";
import { useUiStore } from "@/stores/uiStore";
import { getMapOrNull } from "@/services/core/map";
import type * as ShapeEditor from "./shapeEditing";
import { readonly, ref } from "vue";

// Single boundary for the heavy shape-editing chunk (Terra Draw). The dynamic
// imports live here so every caller shares one split.
let shapeEditor: typeof ShapeEditor | null = null;
let editorRequest = 0;
const phase = ref<"closed" | "loading" | "ready">("closed");
export const shapeEditorPhase = readonly(phase);

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
  if (
    pendingGeometryChange?.fieldName === "geometry" &&
    pendingGeometryChange.newValue !== undefined
  )
    return pendingGeometryChange.newValue;
  return projectStore.getPersistedProject(projectId)?.geometry ?? null;
}

/**
 * Resolve the best available geometry, then lazy-load the editor and start it.
 */
export async function startShapeEditing(projectId: string): Promise<void> {
  editorRequest += 1;
  const request = editorRequest;
  const target = getMapOrNull();
  if (!target) return;
  const uiStore = useUiStore();
  const editTarget = uiStore.editingTarget;
  const auth = useAuthStore();
  const epoch = auth.getSessionEpoch();
  const userId = auth.user?.id;
  function isCurrent(): boolean {
    return (
      request === editorRequest &&
      getMapOrNull() === target &&
      uiStore.mode === "edit" &&
      uiStore.shapeEditorProjectId === projectId &&
      uiStore.editingTarget === editTarget &&
      epoch === auth.getSessionEpoch() &&
      userId === auth.user?.id
    );
  }
  if (!isCurrent()) return;
  phase.value = "loading";
  try {
    const loaded = await import("@/services/shape/shapeEditing");
    if (!isCurrent()) return;
    shapeEditor = loaded;
    shapeEditor.destroyShapeEditor();
    await shapeEditor.initShapeEditor(resolveShapeEditorGeometry(projectId) ?? undefined);
    if (isCurrent()) phase.value = "ready";
  } catch (error) {
    if (!isCurrent()) return;
    disposeShapeEditing();
    throw error;
  }
}

/** Release resources without closing a different editor that replaced this one. */
export function disposeShapeEditing(): void {
  editorRequest += 1;
  phase.value = "closed";
  shapeEditor?.destroyShapeEditor();
}

/** Stop synchronously before map removal, without loading an unused editor chunk. */
export function stopShapeEditing(): void {
  disposeShapeEditing();
  useUiStore().closeShapeEditor();
}
