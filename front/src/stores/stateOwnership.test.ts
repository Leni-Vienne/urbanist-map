import { beforeEach, describe, expect, test } from "bun:test";
import { createPinia, setActivePinia } from "pinia";
import { useOverlayStore } from "./overlayStore";
import { useProjectStore } from "./projectStore";
import { createLocalProject } from "@/utils/typeFactories";
import type { BackendOverlayData, Project, TileOverlayData } from "@/types/index";

function makePersistedProject(name: string, description: string): Project {
  return {
    ...createLocalProject({ id: "project-1", name, description }),
    status: "approved",
  };
}

function makeBackendOverlay(caption: string): BackendOverlayData {
  return {
    id: "overlay-1",
    version: 1,
    filename: "overlay.webp",
    caption,
    authorId: "user-1",
    projectId: "project-1",
    replacesOverlayId: null,
    replacedByOverlayId: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    centroid: { lat: 0.5, lng: 0.5 },
    baselineCaption: caption,
    baselineCorners: [
      { lat: 0, lng: 0 },
      { lat: 0, lng: 1 },
      { lat: 1, lng: 1 },
      { lat: 1, lng: 0 },
    ],
    status: "approved",
  };
}

function makeTileOverlay(id: string): TileOverlayData {
  return {
    id,
    filename: `${id}.webp`,
    caption: id,
    status: "approved",
    projectId: "project-1",
    centroid: { lat: 0.5, lng: 0.5 },
    baselineCorners: [
      { lat: 0, lng: 0 },
      { lat: 0, lng: 1 },
      { lat: 1, lng: 1 },
      { lat: 1, lng: 0 },
    ],
    baselineCaption: id,
  };
}

function activateFreshPinia() {
  setActivePinia(createPinia());
}

function projectDraftTest() {
  const store = useProjectStore();
  store.upsertProjectSummary(makePersistedProject("Server name", "First description"));
  store.updateProjectDraft("project-1", { name: "Draft name" });
  store.upsertProjectSummary(makePersistedProject("New server name", "Fresh description"));

  expect(store.persistedProjects["project-1"]?.name).toBe("New server name");
  expect(store.projectDrafts["project-1"]).toEqual({ id: "project-1", name: "Draft name" });
  expect(store.projects["project-1"]?.name).toBe("Draft name");
  expect(store.projects["project-1"]?.description).toBe("Fresh description");

  store.discardProjectDraft("project-1");
  expect(store.projects["project-1"]?.name).toBe("New server name");
}

function tileTest() {
  const store = useOverlayStore();
  store.replaceTileOverlays(new Map([["tile-1", makeTileOverlay("tile-1")]]));
  store.retainSelectedTileOverlay("tile-1");
  const tileOverlay = store.liveOverlays["tile-1"];
  expect(tileOverlay?.caption).toBe("tile-1");
  expect("updatedAt" in (tileOverlay ?? {})).toBe(false);
  expect("authorId" in (tileOverlay ?? {})).toBe(false);
  expect("version" in (tileOverlay ?? {})).toBe(false);
  expect("replacesOverlayId" in (tileOverlay ?? {})).toBe(false);
  expect(store.persistedOverlays["tile-1"]).toBeUndefined();

  store.replaceTileOverlays(new Map([["tile-2", makeTileOverlay("tile-2")]]));
  expect(store.tileOverlays["tile-1"]).toBeUndefined();
  expect(store.liveOverlays["tile-1"]).toBeDefined();
  expect(store.liveOverlays["tile-2"]).toBeDefined();

  store.clearSelectedTileOverlay();
  expect(store.liveOverlays["tile-1"]).toBeUndefined();
}

function overlayDraftTest() {
  const store = useOverlayStore();
  store.ingestBackendOverlay(makeBackendOverlay("Server caption"));
  store.updateOverlayDraft("overlay-1", { caption: "Draft caption" });
  store.ingestBackendOverlay(makeBackendOverlay("Fresh server caption"));

  expect(store.persistedOverlays["overlay-1"]?.baselineCaption).toBe("Fresh server caption");
  expect(store.liveOverlays["overlay-1"]?.caption).toBe("Draft caption");

  store.ingestBackendOverlay(makeBackendOverlay("Submitted caption"), false);
  expect(store.overlayDrafts["overlay-1"]).toBeUndefined();
  expect(store.liveOverlays["overlay-1"]?.caption).toBe("Submitted caption");
}

function projectStateOwnership() {
  test("keeps backend refreshes separate from changed draft fields", projectDraftTest);
}

function overlayStateOwnership() {
  test("replaces viewport projections without promoting them to persisted state", tileTest);
  test("preserves a draft across backend refresh and drops it after replacement", overlayDraftTest);
}

beforeEach(activateFreshPinia);
describe("project state ownership", projectStateOwnership);
describe("overlay state ownership", overlayStateOwnership);
