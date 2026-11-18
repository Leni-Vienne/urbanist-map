import { beforeEach, describe, expect, spyOn, test } from "bun:test";
import superjson from "superjson";
import type { Map as MaplibreMap } from "maplibre-gl";
import * as map from "@/services/core/map";
import { createPinia, setActivePinia } from "pinia";
import { useSubmissionStore } from "./submissionStore";
import { useMapSessionStore } from "./mapSessionStore";
import { useOverlayStore } from "./overlayStore";
import { useProjectStore } from "./projectStore";
import { useFocusStore } from "./focusStore";
import { useModerationStore } from "./moderationStore";
import { useContributionStore } from "./contributionStore";
import { useAuthStore } from "./authStore";
import { useUiStore } from "./uiStore";
import { useChangeRequestStore } from "./changeRequestStore";
import { useUserContributions } from "@/composables/project/useUserContributions";
import { createLocalProject, overlayWireToData } from "@/utils/typeFactories";
import { openProjectDetailById } from "@/services/core/projectSelection";
import {
  getStagedOverlayModifications,
  hasUnsavedChanges,
  isOverlayUnsaved,
} from "@/services/overlay/unsavedState";
import { getEditModeRestingCorners } from "@/services/overlay/defaultState";
import { hasOpenChangeRequest } from "@/services/overlay/positionState";
import { resolveOverlayCorners } from "@/services/overlay/data";
import { buildOwnOverlayProposal } from "../../../back/src/db/overlayProposal";
import type {
  BackendOverlayData,
  Overlay,
  OverlayObject,
  PendingChangeRequest,
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

function overlayResponse(caption: string): Response {
  const {
    baselineCorners,
    baselineCaption: _baselineCaption,
    ...data
  } = makeBackendOverlay(caption);
  return Response.json([
    { result: { data: superjson.serialize({ ...data, corners: baselineCorners }) } },
  ]);
}

test("overlay hydration shares a request and preserves a newer backend snapshot", async () => {
  const pending = Promise.withResolvers<Response>();
  const started = Promise.withResolvers<void>();
  const originalFetch = globalThis.fetch;
  const fetchSpy = spyOn(globalThis, "fetch").mockImplementationOnce(
    Object.assign(
      () => {
        started.resolve();
        return pending.promise;
      },
      { preconnect: originalFetch.preconnect },
    ),
  );
  try {
    const store = useOverlayStore();
    const first = store.loadOverlay("overlay-1");
    const second = store.loadOverlay("overlay-1");
    await started.promise;
    store.ingestBackendOverlay(makeBackendOverlay("New receipt"));
    pending.resolve(overlayResponse("Old response"));
    expect((await first)?.caption).toBe("New receipt");
    expect((await second)?.caption).toBe("New receipt");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  } finally {
    fetchSpy.mockRestore();
  }
});

test("an overlay request cannot resurrect an overlay removed while it was loading", async () => {
  const pending = Promise.withResolvers<Response>();
  const started = Promise.withResolvers<void>();
  const originalFetch = globalThis.fetch;
  const fetchSpy = spyOn(globalThis, "fetch").mockImplementationOnce(
    Object.assign(
      () => {
        started.resolve();
        return pending.promise;
      },
      { preconnect: originalFetch.preconnect },
    ),
  );
  try {
    const store = useOverlayStore();
    const request = store.loadOverlay("overlay-1");
    await started.promise;
    store.removeOverlay("overlay-1");
    pending.resolve(overlayResponse("Old response"));
    expect(await request).toBeNull();
    expect(store.getOverlayById("overlay-1")).toBeNull();
  } finally {
    fetchSpy.mockRestore();
  }
});

test("a late overlay navigation cannot replace a later project selection", async () => {
  const originalMatchMedia = globalThis.matchMedia;
  globalThis.matchMedia = (media) =>
    Object.assign(new EventTarget(), {
      media,
      matches: false,
      onchange: null,
      addListener() {},
      removeListener() {},
    });
  const pending = Promise.withResolvers<Response>();
  const started = Promise.withResolvers<void>();
  const originalFetch = globalThis.fetch;
  const fetchSpy = spyOn(globalThis, "fetch").mockImplementationOnce(
    Object.assign(
      () => {
        started.resolve();
        return pending.promise;
      },
      { preconnect: originalFetch.preconnect },
    ),
  );
  // Only map identity is needed: retired navigation must never reach camera or layer methods.
  const currentMap = spyOn(map, "getMapOrNull").mockReturnValue({} as MaplibreMap);
  try {
    const { navigateToOverlay } = await import("@/services/overlay/navigation");
    const request = navigateToOverlay("overlay-1");
    await started.promise;
    openProjectDetailById("project-2");
    pending.resolve(overlayResponse("Old response"));
    expect(await request).toBeFalse();
    expect(useFocusStore().selectedProjectId).toBe("project-2");
  } finally {
    fetchSpy.mockRestore();
    currentMap.mockRestore();
    globalThis.matchMedia = originalMatchMedia;
  }
});

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
    rejectionReason: null,
    updatedAt: new Date(0),
    countryCode: "FRA",
    countryName: "France",
  };
}

function authenticateTestUser(role: "admin" | null = null): void {
  useAuthStore().user = {
    id: "user-1",
    email: "user@example.com",
    username: "user",
    role,
    moderatedCountries: [],
    emailVerified: true,
  };
}

function makeLocalOverlay(id: string, projectId: string): OverlayObject {
  const baseline = makeBackendOverlay(id);
  const imageUrl = `data:image/webp;base64,${id}`;
  return {
    ...baseline,
    id,
    filename: `${id}.webp`,
    caption: id,
    status: null,
    projectId,
    imageUrl,
    history: [{ corners: baseline.baselineCorners ?? [], imageUrl }],
    redoStack: [],
    showApprovedPosition: false,
  };
}

function activateFreshPinia() {
  setActivePinia(createPinia());
}

function projectDraftTest() {
  const store = useProjectStore();
  store.upsertProjectSummary(makePersistedProject("Server name", "First description"));
  expect(hasUnsavedChanges()).toBeFalse();
  store.updateProjectDraft("project-1", { name: "Draft name" });
  store.upsertProjectSummary(makePersistedProject("New server name", "Fresh description"));

  expect(store.persistedProjects["project-1"]?.name).toBe("New server name");
  expect(store.projectDrafts["project-1"]).toEqual({ id: "project-1", name: "Draft name" });
  expect(store.projects["project-1"]?.name).toBe("Draft name");
  expect(store.projects["project-1"]?.description).toBe("Fresh description");
  expect(hasUnsavedChanges()).toBeTrue();

  store.discardProjectDraft("project-1");
  expect(store.projects["project-1"]?.name).toBe("New server name");
  expect(hasUnsavedChanges()).toBeFalse();
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
  test("keeps rejected and replaced feedback in Reviewed while pending work stays separate", () => {
    authenticateTestUser();
    const projects = useProjectStore();
    projects.upsertProjectSummary({
      ...makePersistedProject("Rejected project", "Description"),
      ownerId: "user-1",
      status: "rejected",
      rejectionReason: "insufficient_info",
    });
    projects.upsertProjectSummary({
      ...makePersistedProject("Pending project", "Description"),
      id: "pending-project",
      ownerId: "user-1",
      status: "pending",
    });
    useContributionStore().setData({
      projectIds: ["project-1", "pending-project"],
      overlaysById: {
        rejected: {
          ...makePanelOverlay("rejected", "project-1"),
          status: "rejected",
          rejectionReason: "low_quality",
        },
        replaced: { ...makePanelOverlay("replaced", "project-1"), status: "replaced" },
      },
    });

    const contributions = useUserContributions();
    contributions.activeFilter.value = "reviewed";
    expect(contributions.filteredProjects.value.map((project) => project.id)).toEqual([
      "project-1",
    ]);
    expect(contributions.filteredProjects.value[0]?.rejectionReason).toBe("insufficient_info");
    expect(contributions.overlaysById.value.rejected?.rejectionReason).toBe("low_quality");
    expect(contributions.overlaysById.value.replaced?.status).toBe("replaced");
    expect(contributions.filterTabs.value.map((tab) => tab.count)).toEqual([2, 1, 1]);

    contributions.activeFilter.value = "pending";
    expect(contributions.filteredProjects.value.map((project) => project.id)).toEqual([
      "pending-project",
    ]);
  });

  test("replaces viewport projections without promoting them to persisted state", tileTest);
  test("preserves a draft across backend refresh and drops it after replacement", overlayDraftTest);
  test("keeps a submitted caption removal through wire decoding and backend refresh", () => {
    const store = useOverlayStore();
    const baseline = makeBackendOverlay("Server caption");
    store.ingestBackendOverlay(baseline);
    store.updateOverlayDraft(baseline.id, { caption: null });
    expect(isOverlayUnsaved(baseline)).toBe(true);

    const { baselineCorners, baselineCaption: _baselineCaption, ...wire } = baseline;
    const submitted = store.ingestBackendOverlay(
      overlayWireToData({
        ...wire,
        corners: baselineCorners ?? [],
        ownProposal: buildOwnOverlayProposal([{ fieldName: "caption", newValue: null }]),
      }),
      false,
    );
    expect(store.liveOverlays[baseline.id]?.caption).toBeNull();
    expect(store.liveOverlays[baseline.id]?.showApprovedPosition).toBe(false);
    expect(hasOpenChangeRequest(submitted)).toBe(true);
    expect(isOverlayUnsaved(baseline)).toBe(false);
    expect(getStagedOverlayModifications("project-1")).toEqual([]);

    store.ingestBackendOverlay({ ...baseline, ownProposal: { caption: null } });
    expect(store.liveOverlays[baseline.id]?.caption).toBeNull();
  });
  test("a corners-only proposal leaves the caption at its baseline", () => {
    const store = useOverlayStore();
    const baseline = makeBackendOverlay("Server caption");
    store.ingestBackendOverlay({
      ...baseline,
      ownProposal: { corners: baseline.baselineCorners ?? [] },
    });
    expect(store.liveOverlays[baseline.id]?.caption).toBe("Server caption");
    expect(isOverlayUnsaved(baseline)).toBe(false);
  });
  test.each([false, true])(
    "undo preserves the approved-position choice: %s",
    (showApprovedPosition) => {
      authenticateTestUser();
      useUiStore().setMode("edit");
      const store = useOverlayStore();
      const baseline = makeBackendOverlay("Server caption");
      const approved = baseline.baselineCorners ?? [];
      const suggested = approved.map((c) => ({ ...c, lat: c.lat + 1 }));
      store.ingestBackendOverlay({ ...baseline, ownProposal: { corners: suggested } });
      store.updateOverlayDraft(baseline.id, { showApprovedPosition });
      const changes = useChangeRequestStore();
      changes.setPendingChangeRequests([
        {
          id: "own-change",
          entityType: "overlay",
          entityId: baseline.id,
          fieldName: "corners",
          oldValue: approved,
          newValue: suggested,
          changeReason: null,
          status: "pending",
          requestedBy: "user-1",
          requestedByUsername: "user",
          requestedByReportCount: 0,
          createdAt: new Date(0),
          hasConflict: false,
        },
      ]);
      useFocusStore().setSelectionTarget({
        kind: "overlay",
        overlayId: baseline.id,
        projectId: baseline.projectId,
      });
      const restingSide = showApprovedPosition ? "current" : "suggested";
      expect(changes.previewState?.side).toBe(restingSide);
      const resting = showApprovedPosition ? approved : suggested;
      const moved = resting.map((c) => ({ ...c, lng: c.lng + 1 }));

      store.commitOverlayEdit(baseline.id, moved);
      expect(resolveOverlayCorners(store.getOverlayById(baseline.id)!)).toEqual(moved);
      expect(changes.previewState?.side).toBe("suggested");
      expect(isOverlayUnsaved(baseline)).toBe(true);
      store.undoHistory(baseline.id);
      expect(resolveOverlayCorners(store.getOverlayById(baseline.id)!)).toEqual(resting);
      expect(store.getOverlayById(baseline.id)?.showApprovedPosition).toBe(showApprovedPosition);
      expect(changes.previewState?.side).toBe(restingSide);
      expect(isOverlayUnsaved(baseline)).toBe(false);
      store.redoHistory(baseline.id);
      expect(resolveOverlayCorners(store.getOverlayById(baseline.id)!)).toEqual(moved);

      // Returning to the seed keeps undo useful without making the submission dirty.
      store.commitOverlayEdit(baseline.id, resting);
      expect(isOverlayUnsaved(baseline)).toBe(false);
    },
  );
  test("crop undo/redo restores image URLs and corners, including a new edit after undo", () => {
    authenticateTestUser();
    useUiStore().setMode("edit");
    const store = useOverlayStore();
    const local = makeLocalOverlay("local-overlay", "project-1");
    store.addLocalOverlay(local.id, local);
    const cropped = local.history[0]!.corners.map((c) => ({ ...c, lat: c.lat + 0.1 }));
    const image = {
      imageUrl: "data:image/webp;base64,cropped",
      cropRect: { u0: 0, u1: 1, v0: 0.1, v1: 1 },
    };
    store.commitOverlayEdit(local.id, cropped, image);
    expect(store.getOverlayById(local.id)?.imageUrl).toBe(image.imageUrl);
    expect(resolveOverlayCorners(store.getOverlayById(local.id)!)).toEqual(cropped);
    store.undoHistory(local.id);
    expect(store.getOverlayById(local.id)?.imageUrl).toBe(local.imageUrl);
    expect(resolveOverlayCorners(store.getOverlayById(local.id)!)).toEqual(local.baselineCorners);
    store.redoHistory(local.id);
    expect(store.getOverlayById(local.id)?.imageUrl).toBe(image.imageUrl);

    store.undoHistory(local.id);
    store.commitOverlayEdit(local.id, cropped);
    expect(store.getOverlayById(local.id)?.imageUrl).toBe(local.imageUrl);
    expect(store.getOverlayById(local.id)?.redoStack).toEqual([]);
    expect(store.getOverlayById(local.id)?.history.at(-1)?.cropRect).toBeUndefined();
    store.commitOverlayEdit(local.id, cropped, image);
    store.resetHistoryBaseline(local.id);
    expect(store.getOverlayById(local.id)?.imageUrl).toBe(local.imageUrl);
    expect(resolveOverlayCorners(store.getOverlayById(local.id)!)).toEqual(local.baselineCorners);
  });
  test.each([undefined, "Local caption"])(
    "clears a caption removal proposal while preserving a subsequent edit: %s",
    (localCaption) => {
      const store = useOverlayStore();
      const baseline = makeBackendOverlay("Server caption");
      store.ingestBackendOverlay({ ...baseline, ownProposal: { caption: null } });
      if (localCaption !== undefined) {
        store.updateOverlayDraft(baseline.id, { caption: localCaption });
      }
      store.clearPendingChangeRequest(baseline.id);
      const overlay = store.getOverlayById(baseline.id);
      expect(overlay?.ownProposal).toBeUndefined();
      expect(overlay?.caption).toBe(localCaption ?? baseline.caption);
      expect(overlay?.showApprovedPosition).toBe(false);
      expect(isOverlayUnsaved(baseline)).toBe(localCaption !== undefined);
    },
  );
  test("keeps moderation geometry previews separate from the user's own proposal", () => {
    authenticateTestUser("admin");
    const store = useOverlayStore();
    const ui = useUiStore();
    const baseline = makeBackendOverlay("Server caption");
    const ownCorners = makeTileOverlay("own").baselineCorners.map((c) => ({
      lat: c.lat + 1,
      lng: c.lng,
    }));
    const foreignCorners = ownCorners.map((c) => ({ lat: c.lat + 1, lng: c.lng }));
    const overlay = store.ingestBackendOverlay({
      ...baseline,
      ownProposal: { corners: ownCorners, caption: null },
    });
    ui.setMode("edit");
    expect(resolveOverlayCorners(overlay)).toEqual(ownCorners);
    expect(getEditModeRestingCorners(overlay)).toEqual(ownCorners);
    expect(getEditModeRestingCorners({ ...overlay, showApprovedPosition: true })).toEqual(
      baseline.baselineCorners,
    );

    useModerationStore().setModerationData({
      projectIds: [],
      overlaysById: {},
      changeRequests: [
        {
          id: "foreign-change",
          entityType: "overlay",
          entityId: baseline.id,
          fieldName: "corners",
          oldValue: baseline.baselineCorners,
          newValue: foreignCorners,
          changeReason: null,
          status: "pending",
          requestedBy: "another-user",
          requestedByUsername: "another-user",
          requestedByReportCount: 0,
          createdAt: new Date(0),
          hasConflict: false,
        },
      ],
    });
    useFocusStore().setSelectionTarget({
      kind: "overlay",
      overlayId: baseline.id,
      projectId: baseline.projectId,
    });
    useChangeRequestStore().previewIntent = { changeId: "foreign-change", side: "suggested" };
    ui.setMode("moderation");
    expect(resolveOverlayCorners(overlay)).toEqual(foreignCorners);
    ui.setMode("view");
    expect(resolveOverlayCorners(overlay)).toEqual(baseline.baselineCorners);
    ui.setMode("edit");
    expect(resolveOverlayCorners(overlay)).toEqual(ownCorners);
    expect(store.persistedOverlays[baseline.id]?.ownProposal).toEqual({
      corners: ownCorners,
      caption: null,
    });
  });
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
    });
    overlayStore.commitOverlayEdit("overlay-1", makeTileOverlay("preview").baselineCorners, {
      imageUrl: "data:image/webp;base64,local-preview",
    });
    overlayStore.addLocalOverlay("local-overlay", makeLocalOverlay("local-overlay", "project-1"));

    const contributions = useUserContributions();
    expect(contributions.overlaysById.value["overlay-1"]).toMatchObject({
      caption: "Local caption",
      filename: "overlay.webp",
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

test("loads contributions alongside a request for a retired field", async () => {
  authenticateTestUser();
  useUiStore().setMode("edit");
  const project = makePersistedProject("Project", "Description");
  const overlay = makePanelOverlay("overlay-1", project.id);
  const validChange = {
    id: "description-change",
    entityType: "project",
    entityId: project.id,
    fieldName: "description",
    oldValue: project.description,
    newValue: "New description",
    changeReason: null,
    status: "pending",
    requestedBy: "user-1",
    requestedByUsername: "user",
    requestedByReportCount: 0,
    createdAt: new Date(0),
    hasConflict: false,
  } satisfies PendingChangeRequest;
  const data = superjson.serialize({
    projectsById: { [project.id]: project },
    overlaysById: { [overlay.id]: overlay },
    changeRequests: [{ ...validChange, id: "city-change", fieldName: "cityId" }, validChange],
    editSession: { projects: [project], overlays: [] },
  });
  const fetchSpy = spyOn(globalThis, "fetch").mockResolvedValueOnce(
    Response.json([{ result: { data } }]),
  );
  try {
    await useContributionStore().refresh();
    const contributions = useUserContributions();
    expect(contributions.allContributions.value.map((item) => item.id)).toEqual([project.id]);
    expect(contributions.projectOverlayIds.value[project.id]).toEqual([overlay.id]);
    expect(useChangeRequestStore().pendingChangeRequests).toEqual([validChange]);
    expect(useMapSessionStore().snapshot?.projectIds).toEqual([project.id]);
  } finally {
    fetchSpy.mockRestore();
  }
});

test("a fresh application does not inherit submission drafts, locks, or map membership", () => {
  const submission = useSubmissionStore();
  const session = useMapSessionStore();
  submission.pendingSubmission = { projectId: "project-1", entityName: "Draft" };
  submission.setStagedRender("project-1", {
    file: new File(["image"], "render.png", { type: "image/png" }),
    previewUrl: "data:image/png;base64,aW1hZ2U=",
  });
  submission.beginSubmission();
  session.mergeEditSession("project-1", ["overlay-1"]);

  const fresh = createPinia();
  const freshSubmission = useSubmissionStore(fresh);
  expect(freshSubmission.pendingSubmission).toBeNull();
  expect(freshSubmission.isSubmitting).toBeFalse();
  expect(freshSubmission.hasStagedRenders()).toBeFalse();
  expect(useMapSessionStore(fresh).snapshot).toBeNull();
  // Creating another application must not clear work in the original one either.
  expect(submission.hasStagedRender("project-1")).toBeTrue();
  expect(session.snapshot?.overlayIds).toEqual(["overlay-1"]);
});
