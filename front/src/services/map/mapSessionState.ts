import type { AppMode } from "@shared/types";

export type MapSessionMode = Exclude<AppMode, "view">;

export interface MapSessionSnapshot {
  mode: MapSessionMode;
  overlayIds: string[];
  projectIds: string[];
}

let activeMapSession: MapSessionSnapshot | null = null;

export function getMapSessionSnapshot(): Readonly<MapSessionSnapshot> | null {
  return activeMapSession;
}

export function replaceMapSessionSnapshot(snapshot: MapSessionSnapshot): void {
  activeMapSession = snapshot;
}

export function clearMapSessionSnapshot(expectedMode?: MapSessionMode): void {
  if (expectedMode && activeMapSession?.mode !== expectedMode) return;
  activeMapSession = null;
}

export function removeMapSessionOverlay(overlayId: string): void {
  if (!activeMapSession) return;
  activeMapSession = {
    ...activeMapSession,
    overlayIds: activeMapSession.overlayIds.filter((id) => id !== overlayId),
  };
}
