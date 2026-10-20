import { describe, expect, test } from "bun:test";
import { submissionBatchSchema, type SubmissionBatchInput } from "@shared/validation/schemas";
import {
  classifySubmission,
  type ExistingSubmissionOverlay,
  type ExistingSubmissionProject,
  type SubmissionPolicyState,
} from "./submissionPolicy";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const OVERLAY_ID = "22222222-2222-4222-8222-222222222222";
const OTHER_PROJECT_ID = "33333333-3333-4333-8333-333333333333";

function submittedProject(name = "New project") {
  return {
    id: PROJECT_ID,
    name,
    description: null,
    lat: 48.85,
    lng: 2.35,
    proposalDate: null,
    proposalDatePrecision: null,
    startDate: null,
    startDatePrecision: null,
    endDate: null,
    endDatePrecision: null,
    timelineStatus: "planned" as const,
    sourceUrl: null,
    geometry: null,
    tags: ["rail"],
    changedFields: ["name"] as const,
  };
}

function submittedOverlay(projectId = PROJECT_ID) {
  return {
    id: OVERLAY_ID,
    filename: "123456-overlay.webp",
    caption: "New caption",
    projectId,
    corners: [
      { lat: 48.85, lng: 2.35 },
      { lat: 48.85, lng: 2.351 },
      { lat: 48.851, lng: 2.351 },
      { lat: 48.851, lng: 2.35 },
    ],
    changedFields: ["caption"] as const,
  };
}

function parseInput(values: {
  project?: {
    id: string;
    patch: {
      name?: string;
      description?: string;
      startDate?: Date;
      endDate?: Date;
      sourceUrl?: string | null;
    };
  };
  overlays?: ReturnType<typeof submittedOverlay>[];
}): SubmissionBatchInput {
  return submissionBatchSchema.parse({
    projectId: PROJECT_ID,
    project: values.project,
    overlays: values.overlays ?? [],
    reason: "Source correction",
  });
}

function existingProject(status: ExistingSubmissionProject["status"]): ExistingSubmissionProject {
  const { changedFields: _changedFields, ...project } = submittedProject("Old project");
  return {
    ...project,
    status,
    ownerId: "44444444-4444-4444-8444-444444444444",
  };
}

function existingOverlay(projectId = PROJECT_ID): ExistingSubmissionOverlay {
  const { changedFields: _changedFields, ...overlay } = submittedOverlay(projectId);
  return {
    ...overlay,
    status: "approved",
    authorId: "44444444-4444-4444-8444-444444444444",
    kind: "map",
    caption: "Old caption",
    lat: 48.8505,
    lng: 2.3505,
  };
}

function policyState(
  project: ExistingSubmissionProject,
  overlay?: ExistingSubmissionOverlay,
): SubmissionPolicyState {
  return {
    existingProject: project,
    existingOverlays: overlay ? new Map([[overlay.id, overlay]]) : new Map(),
  };
}

function approvedProjectIntent() {
  const plan = classifySubmission(
    parseInput({ project: { id: PROJECT_ID, patch: { name: "New project" } } }),
    policyState(existingProject("approved")),
  );

  expect(plan.project).toBeUndefined();
  expect(plan.changeRequests).toEqual([
    {
      entityType: "project",
      entityId: PROJECT_ID,
      changes: [
        {
          fieldName: "name",
          oldValue: "Old project",
          newValue: "New project",
          changeReason: "Source correction",
        },
      ],
      lat: 48.85,
      lng: 2.35,
    },
  ]);
}

function pendingProjectIntent() {
  const input = parseInput({ project: { id: PROJECT_ID, patch: { name: "New project" } } });
  const plan = classifySubmission(input, policyState(existingProject("pending")));

  expect(plan.project).toMatchObject({ id: PROJECT_ID, name: "New project", tags: ["rail"] });
  expect(plan.changeRequests).toEqual([]);
}

function approvedOverlayIntent() {
  const plan = classifySubmission(
    parseInput({ overlays: [submittedOverlay()] }),
    policyState(existingProject("approved"), existingOverlay()),
  );

  expect(plan.overlays).toEqual([]);
  expect(plan.changeRequests[0]?.changes[0]).toEqual({
    fieldName: "caption",
    oldValue: "Old caption",
    newValue: "New caption",
    changeReason: "Source correction",
  });
}

function noOpApprovedChange() {
  const input = parseInput({ project: { id: PROJECT_ID, patch: { name: "Old project" } } });
  const state = policyState(existingProject("approved"));

  function classifyNoOp() {
    classifySubmission(input, state);
  }

  expect(classifyNoOp).toThrow("No changes supplied for approved project");
}

function crossProjectOverlayId() {
  const input = parseInput({ overlays: [submittedOverlay()] });
  const state = policyState(existingProject("approved"), existingOverlay(OTHER_PROJECT_ID));

  function classifyCrossProjectOverlay() {
    classifySubmission(input, state);
  }

  expect(classifyCrossProjectOverlay).toThrow("Overlay belongs to another project");
}

function submissionPolicy() {
  test("turns approved project intent into a server-sourced change request", approvedProjectIntent);
  test("keeps pending project intent as a direct write", pendingProjectIntent);
  test("classifies an approved overlay from persisted status", approvedOverlayIntent);
  test("rejects a no-op approved change", noOpApprovedChange);
  test("rejects an overlay ID owned by another project", crossProjectOverlayId);
}

describe("submission policy", submissionPolicy);

describe("project patch validation", () => {
  test.each([null, "Short", "A much longer imported project name than the creation form permits"])(
    "allows a description request with unchanged imported name %p",
    (name) => {
      const existing = { ...existingProject("approved"), name, sourceUrl: "legacy invalid URL" };
      const plan = classifySubmission(
        parseInput({
          project: { id: PROJECT_ID, patch: { description: "Corrected description" } },
        }),
        policyState(existing),
      );
      expect(plan.project).toBeUndefined();
      expect(plan.changeRequests[0]?.changes).toEqual([
        {
          fieldName: "description",
          oldValue: null,
          newValue: "Corrected description",
          changeReason: "Source correction",
        },
      ]);
    },
  );

  test("checks a changed end date against the persisted start date", () => {
    const existing = { ...existingProject("approved"), startDate: new Date("2026-06-01") };
    const input = parseInput({
      project: { id: PROJECT_ID, patch: { endDate: new Date("2026-01-01") } },
    });
    expect(() => classifySubmission(input, policyState(existing))).toThrow(
      "validation.endDateBeforeStartDate",
    );
  });

  test("leaves an unrelated imported date inconsistency alone", () => {
    const existing = {
      ...existingProject("approved"),
      startDate: new Date("2026-06-01"),
      endDate: new Date("2026-01-01"),
    };
    const plan = classifySubmission(
      parseInput({ project: { id: PROJECT_ID, patch: { description: "Corrected description" } } }),
      policyState(existing),
    );
    expect(plan.changeRequests).toHaveLength(1);
  });

  test("records explicit field clearing without changing unrelated fields", () => {
    const existing = { ...existingProject("approved"), sourceUrl: "https://example.com" };
    const plan = classifySubmission(
      parseInput({ project: { id: PROJECT_ID, patch: { sourceUrl: null } } }),
      policyState(existing),
    );
    expect(plan.changeRequests[0]?.changes[0]).toMatchObject({
      fieldName: "sourceUrl",
      newValue: null,
    });
  });
});
