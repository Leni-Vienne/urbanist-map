// The single-overlay fixtures and seeded stores below guarantee these lookups exist.
/* oxlint-disable typescript/no-non-null-assertion */
import { afterAll, afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { createPinia, setActivePinia } from "pinia";
import superjson from "superjson";
import type { RouterOutput } from "@/client";
import type { OverlayObject } from "@/types/index";
import type { SubmissionBatchInput } from "@shared/validation/schemas";
import { useAuthStore } from "@/stores/authStore";
import { useProjectStore } from "@/stores/projectStore";
import { useOverlayStore } from "@/stores/overlayStore";
import { useContributionStore } from "@/stores/contributionStore";
import { useChangeRequestStore } from "@/stores/changeRequestStore";
import { useUiStore } from "@/stores/uiStore";
import { createLocalProject, overlayWireToData, projectFromWire } from "@/utils/typeFactories";
import {
  getMapSessionSnapshot,
  clearMapSessionSnapshot,
  replaceMapSessionSnapshot,
} from "@/services/map/mapSessionState";
import { getStagedOverlayModifications, isOverlayUnsaved } from "@/services/overlay/unsavedState";
import {
  clearAllStagedRenders,
  clearStagedRender,
  getStagedRender,
  setStagedRender,
} from "./stagedRenderState";
import type { SubmissionDraft } from "./submissionTypes";
import { isSubmitting } from "./submissionState";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const OVERLAY_ID = "22222222-2222-4222-8222-222222222222";
const USER_ID = "33333333-3333-4333-8333-333333333333";
const originalFetch = globalThis.fetch;
const originalMatchMedia = globalThis.matchMedia;
const originalStorage = globalThis.localStorage;
// The map modules register their viewport listener at import. These tests run without a DOM.
globalThis.matchMedia = (media) =>
  Object.assign(new EventTarget(), {
    media,
    matches: false,
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
  });
const stored = new Map<string, string>();
globalThis.localStorage = {
  get length() {
    return stored.size;
  },
  getItem: (key) => stored.get(key) ?? null,
  setItem: (key, value) => {
    stored.set(key, value);
  },
  removeItem: (key) => {
    stored.delete(key);
  },
  clear: () => {
    stored.clear();
  },
  key: (index) => [...stored.keys()][index] ?? null,
};
const { detectProjectChanges, submitDraft } = await import("./submissionService");
const { refreshUserContributions } = await import("@/services/project/userContributions");
afterAll(() => {
  globalThis.matchMedia = originalMatchMedia;
  globalThis.localStorage = originalStorage;
});
type SubmissionResult = RouterOutput["submission"]["submit"];
const corners = [
  { lat: 48, lng: 2 },
  { lat: 48, lng: 2.001 },
  { lat: 47.999, lng: 2.001 },
  { lat: 47.999, lng: 2 },
];

function receipt(status: "pending" | "approved" = "pending"): SubmissionResult {
  return {
    outcome: { createdEntities: 2, changeRequests: 0 },
    render: undefined,
    receipt: {
      project: {
        ...createLocalProject({
          id: PROJECT_ID,
          name: "Example project",
          lat: 48,
          lng: 2,
          ownerId: USER_ID,
        }),
        status,
        importSource: null,
      },
      mapOverlays: [
        {
          id: OVERLAY_ID,
          filename: "123456-image.webp",
          caption: "Submitted caption",
          status,
          projectId: PROJECT_ID,
          authorId: USER_ID,
          version: 2,
          replacesOverlayId: null,
          replacedByOverlayId: null,
          corners,
          centroid: { lat: 48, lng: 2 },
          createdAt: new Date(0),
          updatedAt: new Date(1),
          ownProposal: undefined,
        },
      ],
      images: [
        {
          id: OVERLAY_ID,
          filename: "123456-image.webp",
          caption: "Submitted caption",
          status,
          projectId: PROJECT_ID,
          authorId: USER_ID,
          version: 2,
          kind: "map",
          authorUsername: "User",
          authorApprovedCount: 0,
          authorRejectedCount: 0,
          replacesOverlayId: null,
          replacedByOverlayId: null,
          updatedAt: new Date(1),
          countryCode: "FRA",
          countryName: "France",
        },
      ],
      changeRequests: [],
    },
  };
}

function localOverlay(): OverlayObject {
  return {
    ...overlayWireToData(receipt().receipt.mapOverlays[0]!),
    status: null,
    imageUrl: "https://example.com/123456-image.webp",
    history: [{ corners, imageUrl: "https://example.com/123456-image.webp" }],
    redoStack: [],
    positionState: "baseline",
  };
}

function draft(): SubmissionDraft {
  return {
    projectId: PROJECT_ID,
    entityName: "Example project",
    projectChanges: [],
    newOverlayIds: [OVERLAY_ID],
    overlayModifications: [],
  };
}

function seedLocal(): void {
  useProjectStore().addLocalProject(
    createLocalProject({
      id: PROJECT_ID,
      name: "Example project",
      lat: 48,
      lng: 2,
      ownerId: USER_ID,
    }),
  );
  useOverlayStore().addLocalOverlay(OVERLAY_ID, localOverlay());
}

function response(result: SubmissionResult): Response {
  return Response.json([{ result: { data: superjson.serialize(result) } }]);
}

beforeEach(() => {
  setActivePinia(createPinia());
  clearMapSessionSnapshot();
  clearAllStagedRenders();
  useAuthStore().user = {
    id: USER_ID,
    email: "user@example.com",
    username: "User",
    role: null,
    moderatedCountries: [],
    emailVerified: true,
  };
  useUiStore().activeTab = "contribute";
});
afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("submission acknowledgement", () => {
  test("acknowledges new entities and list membership without a contributions request", async () => {
    seedLocal();
    replaceMapSessionSnapshot({
      mode: "edit",
      projectIds: ["unrelated-project"],
      overlayIds: ["unrelated-overlay"],
    });
    const fetchSpy = spyOn(globalThis, "fetch").mockResolvedValue(response(receipt()));
    await submitDraft(draft(), "");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(String(fetchSpy.mock.calls[0]?.[0])).toContain("submission.submit");
    expect(useProjectStore().getProjectById(PROJECT_ID)?.status).toBe("pending");
    expect(useProjectStore().hasProjectDraft(PROJECT_ID)).toBeFalse();
    const saved = useOverlayStore().getOverlayById(OVERLAY_ID)!;
    expect(saved.status).toBe("pending");
    expect(saved.version).toBe(2);
    expect(saved.history).toEqual([]);
    expect(isOverlayUnsaved(saved)).toBeFalse();
    expect(useContributionStore().projectIds).toContain(PROJECT_ID);
    expect(useContributionStore().overlaysById[OVERLAY_ID]?.status).toBe("pending");
    expect(getMapSessionSnapshot()?.overlayIds).toEqual(["unrelated-overlay", OVERLAY_ID]);
  });

  test("submits only the edited field of a short-named imported project", async () => {
    const result = receipt("approved");
    result.receipt.project.name = "Short";
    result.receipt.mapOverlays = [];
    result.receipt.images = [];
    useProjectStore().upsertProjectSummary(projectFromWire(result.receipt.project));
    useProjectStore().updateProjectDraft(PROJECT_ID, { description: "A correction" });
    const inputs: SubmissionBatchInput[] = [];
    spyOn(globalThis, "fetch").mockImplementation(
      Object.assign(
        async (_url: URL | RequestInfo, options?: RequestInit) => {
          inputs.push(
            superjson.deserialize<SubmissionBatchInput>(JSON.parse(String(options?.body))["0"]),
          );
          return response(result);
        },
        { preconnect: originalFetch.preconnect },
      ),
    );
    const project = useProjectStore().getProjectById(PROJECT_ID)!;
    await submitDraft(
      { ...draft(), projectChanges: detectProjectChanges(project), newOverlayIds: [] },
      "Correction",
    );
    expect(inputs[0]?.project).toEqual({ id: PROJECT_ID, patch: { description: "A correction" } });
    expect(useProjectStore().getProjectById(PROJECT_ID)?.name).toBe("Short");
    expect(useProjectStore().hasProjectDraft(PROJECT_ID)).toBeFalse();
  });

  test("clears submitted overlay edits while retaining the server's open proposal", async () => {
    const result = receipt("approved");
    const wire = result.receipt.mapOverlays[0]!;
    wire.caption = "Approved caption";
    wire.ownProposal = { caption: "Submitted caption" };
    useProjectStore().upsertProjectSummary(projectFromWire(result.receipt.project));
    useOverlayStore().ingestBackendOverlay(overlayWireToData({ ...wire, ownProposal: undefined }));
    useOverlayStore().updateOverlayDraft(OVERLAY_ID, { caption: "Submitted caption" });
    result.receipt.changeRequests = [
      {
        id: crypto.randomUUID(),
        entityType: "overlay",
        entityId: OVERLAY_ID,
        fieldName: "caption",
        oldValue: "Approved caption",
        newValue: "Submitted caption",
        changeReason: null,
        status: "pending",
        requestedBy: USER_ID,
        requestedByUsername: "User",
        requestedByReportCount: 0,
        createdAt: new Date(),
        hasConflict: false,
      },
    ];
    spyOn(globalThis, "fetch").mockResolvedValue(response(result));
    await submitDraft(
      {
        ...draft(),
        projectChanges: undefined,
        newOverlayIds: [],
        overlayModifications: getStagedOverlayModifications(PROJECT_ID),
      },
      "",
    );
    const saved = useOverlayStore().getOverlayById(OVERLAY_ID)!;
    expect(saved.baselineCaption).toBe("Approved caption");
    expect(saved.caption).toBe("Submitted caption");
    expect(isOverlayUnsaved(saved)).toBeFalse();
    expect(useChangeRequestStore().pendingChangeRequests[0]?.newValue).toBe("Submitted caption");
  });

  test("freezes draft edits and undo/redo until the submission is acknowledged", async () => {
    seedLocal();
    const overlayStore = useOverlayStore();
    const imageUrl = localOverlay().imageUrl;
    const moved = corners.map((corner) => ({ lat: corner.lat + 0.001, lng: corner.lng }));
    overlayStore.commitHistory(OVERLAY_ID, [
      { corners: moved, imageUrl },
      { corners, imageUrl },
    ]);
    overlayStore.updateOverlayDraft(OVERLAY_ID, { redoStack: [{ corners: moved, imageUrl }] });
    const file = new File(["first"], "first.png", { type: "image/png" });
    setStagedRender(PROJECT_ID, { file, previewUrl: "first" });
    const started = Promise.withResolvers<undefined>();
    const delayed = Promise.withResolvers<Response>();
    spyOn(globalThis, "fetch").mockImplementation(
      Object.assign(
        async (url: URL | RequestInfo) => {
          if (String(url).includes("upload-image"))
            return Response.json({ filename: "123456-render.webp" });
          started.resolve(undefined);
          return delayed.promise;
        },
        { preconnect: originalFetch.preconnect },
      ),
    );
    const request = submitDraft(
      { ...draft(), pendingRender: { id: crypto.randomUUID(), file, previewUrl: "first" } },
      "",
    );
    await started.promise;
    expect(isSubmitting.value).toBeTrue();
    const duplicate = await submitDraft(draft(), "").catch((error: unknown) => error);
    expect(duplicate).toBeInstanceOf(Error);
    expect(isSubmitting.value).toBeTrue();
    useProjectStore().updateProjectDraft(PROJECT_ID, { name: "Later project name" });
    expect(useProjectStore().resetProjectField(PROJECT_ID, "name")).toBeFalse();
    overlayStore.updateOverlayDraft(OVERLAY_ID, { caption: "Later caption" });
    overlayStore.commitHistory(OVERLAY_ID, [
      { corners, imageUrl: localOverlay().imageUrl },
      { corners: moved, imageUrl: localOverlay().imageUrl },
    ]);
    expect(overlayStore.undoHistory(OVERLAY_ID)).toBeNull();
    expect(overlayStore.redoHistory(OVERLAY_ID)).toBeNull();
    const laterFile = new File(["second"], "second.png");
    setStagedRender(PROJECT_ID, { file: laterFile, previewUrl: "second" });
    clearStagedRender(PROJECT_ID);
    expect(useProjectStore().getProjectById(PROJECT_ID)?.name).toBe("Example project");
    expect(overlayStore.getOverlayById(OVERLAY_ID)?.caption).toBe("Submitted caption");
    expect(overlayStore.getOverlayById(OVERLAY_ID)?.history).toHaveLength(2);
    expect(getStagedRender(PROJECT_ID)?.file).toBe(file);
    const result = receipt();
    result.render = {
      id: crypto.randomUUID(),
      filename: "123456-render.webp",
      status: "pending",
      authorId: USER_ID,
    };
    delayed.resolve(response(result));
    await request;
    expect(isSubmitting.value).toBeFalse();
    expect(useProjectStore().getProjectById(PROJECT_ID)?.name).toBe("Example project");
    expect(useProjectStore().getProjectById(PROJECT_ID)?.status).toBe("pending");
    const overlay = useOverlayStore().getOverlayById(OVERLAY_ID)!;
    expect(overlay.caption).toBe("Submitted caption");
    expect(overlay.history).toEqual([]);
    expect(isOverlayUnsaved(overlay)).toBeFalse();
    expect(getStagedRender(PROJECT_ID)).toBeUndefined();
    overlayStore.updateOverlayDraft(OVERLAY_ID, { caption: "Next edit" });
    expect(overlayStore.getOverlayById(OVERLAY_ID)?.caption).toBe("Next edit");
    setStagedRender(PROJECT_ID, { file: laterFile, previewUrl: "second" });
    clearStagedRender(PROJECT_ID);
    expect(getStagedRender(PROJECT_ID)).toBeUndefined();
  });

  test("retains local work on mutation failure", async () => {
    seedLocal();
    spyOn(globalThis, "fetch").mockRejectedValue(new Error("Network unavailable"));
    const failure = await submitDraft(draft(), "").catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(Error);
    expect(useProjectStore().getProjectById(PROJECT_ID)?.status).toBeNull();
    expect(useOverlayStore().getOverlayById(OVERLAY_ID)?.status).toBeNull();
    expect(isSubmitting.value).toBeFalse();
    useProjectStore().updateProjectDraft(PROJECT_ID, { name: "Retry project name" });
    expect(useProjectStore().getProjectById(PROJECT_ID)?.name).toBe("Retry project name");
  });

  test("freezes edits during uploads and releases them when an upload fails", async () => {
    seedLocal();
    const file = new File(["render"], "render.png", { type: "image/png" });
    const started = Promise.withResolvers<undefined>();
    const delayed = Promise.withResolvers<Response>();
    spyOn(globalThis, "fetch").mockImplementation(
      Object.assign(
        async () => {
          started.resolve(undefined);
          return delayed.promise;
        },
        { preconnect: originalFetch.preconnect },
      ),
    );
    const request = submitDraft(
      { ...draft(), pendingRender: { id: crypto.randomUUID(), file, previewUrl: "render" } },
      "",
    );
    await started.promise;
    expect(isSubmitting.value).toBeTrue();
    useOverlayStore().updateOverlayDraft(OVERLAY_ID, { caption: "Blocked edit" });
    expect(useOverlayStore().getOverlayById(OVERLAY_ID)?.caption).toBe("Submitted caption");
    delayed.resolve(Response.json({ error: "upload.error.uploadFailed" }, { status: 500 }));
    expect(await request.catch((error: unknown) => error)).toBeInstanceOf(Error);
    expect(isSubmitting.value).toBeFalse();
    useOverlayStore().updateOverlayDraft(OVERLAY_ID, { caption: "Retry caption" });
    expect(useOverlayStore().getOverlayById(OVERLAY_ID)?.caption).toBe("Retry caption");
  });

  test("validation failure releases the edit lock without sending a request", async () => {
    seedLocal();
    useProjectStore().updateProjectDraft(PROJECT_ID, { name: "Short" });
    const fetchSpy = spyOn(globalThis, "fetch").mockRejectedValue(new Error("Unexpected request"));
    expect(await submitDraft(draft(), "").catch((error: unknown) => error)).toBeInstanceOf(Error);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(isSubmitting.value).toBeFalse();
    useProjectStore().updateProjectDraft(PROJECT_ID, { name: "Corrected project name" });
    expect(useProjectStore().getProjectById(PROJECT_ID)?.name).toBe("Corrected project name");
  });

  test("reuses an uploaded overlay and render after a failed mutation", async () => {
    seedLocal();
    const imageUrl = "data:image/png;base64,aGVsbG8=";
    useOverlayStore().updateOverlayDraft(OVERLAY_ID, { imageUrl });
    const file = new File(["render"], "render.png", { type: "image/png" });
    const submission = {
      ...draft(),
      pendingRender: { id: crypto.randomUUID(), file, previewUrl: "render" },
    };
    let uploads = 0;
    let mutations = 0;
    spyOn(globalThis, "fetch").mockImplementation(
      Object.assign(
        async (url: URL | RequestInfo) => {
          if (String(url).startsWith("data:")) return originalFetch(url);
          if (String(url).includes("upload-image")) {
            uploads += 1;
            return Response.json({ filename: `123456-image${uploads}.webp` });
          }
          mutations += 1;
          if (mutations === 1) throw new Error("Network unavailable");
          return response(receipt());
        },
        { preconnect: originalFetch.preconnect },
      ),
    );
    const failure = await submitDraft(submission, "").catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(Error);
    await submitDraft(submission, "");
    expect(uploads).toBe(2);
    expect(mutations).toBe(2);
  });

  test("an older contributions response cannot overwrite the acknowledged state", async () => {
    seedLocal();
    const started = Promise.withResolvers<undefined>();
    const delayed = Promise.withResolvers<Response>();
    spyOn(globalThis, "fetch").mockImplementation(
      Object.assign(
        async (url: URL | RequestInfo) => {
          if (String(url).includes("getUsersContributions")) {
            started.resolve(undefined);
            return delayed.promise;
          }
          return response(receipt());
        },
        { preconnect: originalFetch.preconnect },
      ),
    );
    const refresh = refreshUserContributions();
    await started.promise;
    await submitDraft(draft(), "");
    delayed.resolve(
      Response.json([
        {
          result: {
            data: superjson.serialize({
              projectsById: {},
              overlaysById: {},
              changeRequests: [],
              editSession: { projects: [], overlays: [] },
            }),
          },
        },
      ]),
    );
    await refresh;
    expect(useContributionStore().projectIds).toContain(PROJECT_ID);
    expect(useOverlayStore().getOverlayById(OVERLAY_ID)?.status).toBe("pending");
    expect(getMapSessionSnapshot()?.overlayIds).toContain(OVERLAY_ID);
  });

  test("a late mutation response cannot populate a different account's stores", async () => {
    seedLocal();
    const started = Promise.withResolvers<undefined>();
    const delayed = Promise.withResolvers<Response>();
    spyOn(globalThis, "fetch").mockImplementation(
      Object.assign(
        async () => {
          started.resolve(undefined);
          return delayed.promise;
        },
        { preconnect: originalFetch.preconnect },
      ),
    );
    const request = submitDraft(draft(), "");
    await started.promise;
    useAuthStore().user = { ...useAuthStore().user!, id: "another-user" };
    useProjectStore().clearAllState();
    useOverlayStore().clearAllState();
    delayed.resolve(response(receipt()));
    await request;
    expect(useProjectStore().getProjectById(PROJECT_ID)).toBeNull();
    expect(useOverlayStore().getOverlayById(OVERLAY_ID)).toBeNull();
    expect(useContributionStore().projectIds).toEqual([]);
  });
});
