import { beforeEach, describe, expect, test } from "bun:test";
import { createPinia, setActivePinia } from "pinia";
import { useOverlayStore } from "./overlayStore";
import { useProjectStore } from "./projectStore";
import { useFocusStore } from "./focusStore";
import { useModerationStore } from "./moderationStore";
import { useContributionStore } from "./contributionStore";
import { useAuthStore } from "./authStore";
import { useUserContributions } from "@/composables/project/useUserContributions";
import { createLocalProject } from "@/utils/typeFactories";
import { openProjectDetailById } from "@/services/core/projectSelection";
import type {
  BackendOverlayData,
  Overlay,
  OverlayObject,
  Project,
  TileOverlayData,
} from "@/types/index";

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

function makeTileOverlay(id: string, projectId = "project-1"): TileOverlayData {
  return {
    id,
    filename: `${id}.webp`,
    caption: id,
    status: "approved",
    projectId,
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

function makePanelOverlay(id: string, projectId: string): Overlay {
  return {
    id,
    caption: id,
    filename: `${id}.webp`,
    status: "pending",
    kind: "map",
    version: 1,
    projectId,
    authorId: "user-1",
    authorUsername: "user",
    authorApprovedCount: 0,
    authorRejectedCount: 0,
    replacesOverlayId: null,
    replacedByOverlayId: null,
    updatedAt: new Date(0),
    countryCode: "FRA",
    countryName: "France",
  };
}

function authenticateTestUser(): void {
  useAuthStore().user = {
    id: "user-1",
    email: "user@example.com",
    username: "user",
    role: null,
    moderatedCountries: [],
    emailVerified: true,
  };
}

function makeLocalOverlay(id: string, projectId: string): OverlayObject {
  return {
    ...makeBackendOverlay(id),
    id,
    filename: `${id}.webp`,
    caption: id,
    status: null,
    projectId,
    imageUrl: `data:image/webp;base64,${id}`,
    history: [],
    redoStack: [],
    positionState: "baseline",
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
  test("selects an uncached project immediately by id", () => {
    openProjectDetailById("project-a");
    openProjectDetailById("project-b");

    const focus = useFocusStore();
    expect(focus.selectedProjectId).toBe("project-b");
    expect(focus.selectedProject).toBeNull();
    expect(focus.detailVisible).toBe(true);
  });
}

function overlayStateOwnership() {
  test("replaces viewport projections without promoting them to persisted state", tileTest);
  test("preserves a draft across backend refresh and drops it after replacement", overlayDraftTest);
  test("projects local overlay edits into contribution rows without dropping list metadata", () => {
    authenticateTestUser();
    const projectStore = useProjectStore();
    const overlayStore = useOverlayStore();
    const contributionStore = useContributionStore();
    projectStore.upsertProjectSummary(makePersistedProject("Project", "Description"));

    const pending = {
      ...makePanelOverlay("overlay-1", "project-1"),
      authorApprovedCount: 7,
      authorRejectedCount: 2,
    };
    const render = {
      ...makePanelOverlay("render-1", "project-1"),
      kind: "render" as const,
      status: "approved" as const,
    };
    const rejected = {
      ...makePanelOverlay("rejected-1", "project-1"),
      status: "rejected" as const,
      replacedByOverlayId: "replacement-1",
    };
    contributionStore.setData({
      projectIds: ["project-1"],
      overlaysById: {
        "overlay-1": pending,
        "render-1": render,
        "rejected-1": rejected,
      },
    });

    overlayStore.ingestBackendOverlay({
      ...makeBackendOverlay("Server caption"),
      status: "pending",
    });
    overlayStore.updateOverlayDraft("overlay-1", {
      caption: "Local caption",
      filename: "local-preview.webp",
      imageUrl: "data:image/webp;base64,local-preview",
    });
    overlayStore.addLocalOverlay("local-overlay", makeLocalOverlay("local-overlay", "project-1"));

    const contributions = useUserContributions();
    expect(contributions.overlaysById.value["overlay-1"]).toMatchObject({
      caption: "Local caption",
      filename: "local-preview.webp",
      imageUrl: "data:image/webp;base64,local-preview",
      authorUsername: "user",
      authorApprovedCount: 7,
      authorRejectedCount: 2,
    });
    expect(contributions.overlaysById.value["render-1"]).toMatchObject(render);
    expect(contributions.overlaysById.value["rejected-1"]).toMatchObject(rejected);
    expect(contributions.overlaysById.value["local-overlay"]?.status).toBeNull();
    expect(contributions.projectOverlayIds.value["project-1"]).toEqual([
      "overlay-1",
      "render-1",
      "rejected-1",
      "local-overlay",
    ]);
  });

  test("includes live overlays for an externally selected project", () => {
    authenticateTestUser();
    const projectStore = useProjectStore();
    const overlayStore = useOverlayStore();
    const contributionStore = useContributionStore();
    const focusStore = useFocusStore();
    const externalProject = {
      ...makePersistedProject("External", "Description"),
      id: "external-project",
      ownerId: "another-user",
    };
    projectStore.upsertProjectSummary(externalProject);
    contributionStore.setData({ projectIds: [], overlaysById: {} });
    overlayStore.replaceTileOverlays(
      new Map([["external-overlay", makeTileOverlay("external-overlay", "external-project")]]),
    );
    focusStore.setSelectionTarget({ kind: "project", projectId: "external-project" });

    const contributions = useUserContributions();
    expect(contributions.pinnedExternalProject.value?.id).toBe("external-project");
    expect(contributions.projectOverlayIds.value["external-project"]).toEqual(["external-overlay"]);
  });
}

function moderationStateOwnership() {
  test("derives project overlay groups from the normalized snapshot", () => {
    const store = useModerationStore();
    store.setModerationData({
      projectIds: ["project-1", "project-2"],
      overlaysById: {
        "overlay-1": makePanelOverlay("overlay-1", "project-1"),
        "overlay-2": makePanelOverlay("overlay-2", "project-1"),
        "overlay-outside": makePanelOverlay("overlay-outside", "project-outside"),
      },
      changeRequests: [],
    });

    expect(store.projectOverlayIds).toEqual({
      "project-1": ["overlay-1", "overlay-2"],
      "project-2": [],
    });
  });
}

beforeEach(activateFreshPinia);
describe("project state ownership", projectStateOwnership);
describe("overlay state ownership", overlayStateOwnership);
describe("moderation state ownership", moderationStateOwnership);
