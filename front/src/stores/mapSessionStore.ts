import { defineStore } from "pinia";
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

export const useMapSessionStore = defineStore("mapSession", () => {
  const overlayStore = useOverlayStore();
  const projectStore = useProjectStore();

  // Retained application state, including while no map is mounted. Writers replace the snapshot.
  const snapshot = shallowRef<MapSessionSnapshot | null>(null);

  function clearAllState(): void {
    snapshot.value = null;
  }

  function mergeEditSession(projectId: string, overlayIds: string[]): void {
    const current = snapshot.value?.mode === "edit" ? snapshot.value : null;
    snapshot.value = {
      mode: "edit",
      projectIds: [...new Set([...(current?.projectIds ?? []), projectId])],
      overlayIds: [...new Set([...(current?.overlayIds ?? []), ...overlayIds])],
    };
  }

  function removeMapSessionOverlay(overlayId: string): void {
    if (!snapshot.value) return;
    snapshot.value = {
      ...snapshot.value,
      overlayIds: snapshot.value.overlayIds.filter((id) => id !== overlayId),
    };
  }

  function cacheMapSessionOverlays(overlaysData: BackendOverlayData[]): string[] {
    return overlaysData.map((overlayData) => overlayStore.ingestBackendOverlay(overlayData).id);
  }

  function cacheMapSessionProjects(projects: ProjectWire[]): string[] {
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

    for (const overlay of Object.values(overlayStore.liveOverlays)) {
      if (overlay.ownProposal !== undefined && !sessionIds.has(overlay.id)) {
        overlayStore.clearPendingChangeRequest(overlay.id);
      }
    }
  }

  // Cache fetched session entities and publish their explicit mode-scoped membership.
  function applyMapSessionRows(
    mode: "edit" | "moderation",
    projects: ProjectWire[],
    overlays: BackendOverlayData[],
  ): string[] {
    const projectIds = cacheMapSessionProjects(projects);
    const overlayIds = cacheMapSessionOverlays(overlays);
    if (mode === "edit") clearResolvedChangeRequestState(overlayIds);
    snapshot.value = { mode, overlayIds, projectIds };
    return projectIds;
  }

  return {
    snapshot,
    clearAllState,
    mergeEditSession,
    removeMapSessionOverlay,
    applyMapSessionRows,
  };
});
