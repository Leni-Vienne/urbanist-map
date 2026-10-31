import { shallowRef } from "vue";
import { useOverlayStore } from "@/stores/overlayStore";
import { useProjectStore } from "@/stores/projectStore";
import { projectFromWire, type ProjectWire } from "@/utils/typeFactories";
import type { BackendOverlayData } from "@/types/index";
import type { AppMode } from "@shared/types";

export type MapSessionMode = Exclude<AppMode, "view">;

export interface MapSessionSnapshot {
  mode: MapSessionMode;
  overlayIds: string[];
  projectIds: string[];
}

// Retained application state, including while no map is mounted. Writers replace the snapshot.
const activeMapSession = shallowRef<MapSessionSnapshot | null>(null);

export function getMapSessionSnapshot(): Readonly<MapSessionSnapshot> | null {
  return activeMapSession.value;
}

export function replaceMapSessionSnapshot(snapshot: MapSessionSnapshot): void {
  activeMapSession.value = snapshot;
}

export function clearMapSessionSnapshot(): void {
  activeMapSession.value = null;
}

export function mergeEditSession(projectId: string, overlayIds: string[]): void {
  const current = activeMapSession.value?.mode === "edit" ? activeMapSession.value : null;
  activeMapSession.value = {
    mode: "edit",
    projectIds: [...new Set([...(current?.projectIds ?? []), projectId])],
    overlayIds: [...new Set([...(current?.overlayIds ?? []), ...overlayIds])],
  };
}

export function removeMapSessionOverlay(overlayId: string): void {
  if (!activeMapSession.value) return;
  activeMapSession.value = {
    ...activeMapSession.value,
    overlayIds: activeMapSession.value.overlayIds.filter((id) => id !== overlayId),
  };
}

function cacheMapSessionOverlays(overlaysData: BackendOverlayData[]): string[] {
  const overlayStore = useOverlayStore();
  return overlaysData.map((overlayData) => overlayStore.ingestBackendOverlay(overlayData).id);
}

function cacheMapSessionProjects(projects: ProjectWire[]): string[] {
  const projectStore = useProjectStore();
  const projectIds: string[] = [];
  for (const project of projects) {
    const stored = projectStore.upsertProjectSummary(projectFromWire(project));
    projectIds.push(stored.id);
  }
  return projectIds;
}

// The edit-session set contains every overlay the user has an open change request on, so an
// overlay carrying change-request state but absent from it has none anymore (it was resolved).
function clearResolvedChangeRequestState(sessionOverlayIds: string[]): void {
  const sessionIds = new Set(sessionOverlayIds);
  const overlayStore = useOverlayStore();

  for (const overlay of Object.values(overlayStore.liveOverlays)) {
    if (overlay.ownProposal !== undefined && !sessionIds.has(overlay.id)) {
      overlayStore.clearPendingChangeRequest(overlay.id);
    }
  }
}

// Cache fetched session entities and publish their explicit mode-scoped membership.
export function applyMapSessionRows(
  mode: "edit" | "moderation",
  projects: ProjectWire[],
  overlays: BackendOverlayData[],
): string[] {
  const projectIds = cacheMapSessionProjects(projects);
  const overlayIds = cacheMapSessionOverlays(overlays);
  if (mode === "edit") clearResolvedChangeRequestState(overlayIds);
  replaceMapSessionSnapshot({ mode, overlayIds, projectIds });
  return projectIds;
}
