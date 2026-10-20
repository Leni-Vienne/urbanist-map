import { describe, expect, test } from "bun:test";
import { submissionBatchSchema } from "./schemas";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const OVERLAY_ID = "22222222-2222-4222-8222-222222222222";

function validProject() {
  return {
    id: PROJECT_ID,
    name: "Test project",
    description: null,
    lat: 48.85,
    lng: 2.35,
    proposalDate: null,
    startDate: null,
    endDate: null,
    timelineStatus: "planned" as const,
    sourceUrl: null,
    geometry: null,
    tags: ["rail"],
    changedFields: ["name"] as const,
  };
}

function validOverlay() {
  return {
    id: OVERLAY_ID,
    filename: "123456-overlay.webp",
    caption: "New caption",
    projectId: PROJECT_ID,
    corners: [
      { lat: 48.85, lng: 2.35 },
      { lat: 48.85, lng: 2.351 },
      { lat: 48.851, lng: 2.351 },
      { lat: 48.851, lng: 2.35 },
    ],
    changedFields: ["caption"] as const,
  };
}

function acceptsIntent() {
  const result = submissionBatchSchema.safeParse({
    projectId: PROJECT_ID,
    project: { id: PROJECT_ID, patch: { name: "Updated project" } },
    overlays: [validOverlay()],
    reason: "Correct the published data",
  });

  expect(result.success).toBeTrue();
}

function rejectsOldBucket() {
  const result = submissionBatchSchema.safeParse({
    projectId: PROJECT_ID,
    overlays: [],
    changeRequests: [
      {
        entityType: "project",
        entityId: PROJECT_ID,
        changes: [{ fieldName: "name", oldValue: "Old", newValue: "New" }],
      },
    ],
  });

  expect(result.success).toBeFalse();
}

function rejectsDuplicateFields() {
  const overlay = { ...validOverlay(), changedFields: ["caption", "caption"] };
  const result = submissionBatchSchema.safeParse({
    projectId: PROJECT_ID,
    overlays: [overlay],
  });

  expect(result.success).toBeFalse();
}

function submissionIntentContract() {
  test("accepts project patches and overlay intents", acceptsIntent);
  test("rejects the removed frontend-classified change-request bucket", rejectsOldBucket);
  test("rejects duplicate changed fields", rejectsDuplicateFields);
}

describe("submission intent contract", submissionIntentContract);

describe("project create and edit contract", () => {
  test("accepts a complete new project", () => {
    const result = submissionBatchSchema.safeParse({
      projectId: PROJECT_ID,
      project: { id: PROJECT_ID, create: validProject() },
      overlays: [],
    });
    expect(result.success).toBeTrue();
  });
  test.each(["Short", "", null])("rejects invalid name %p when creating", (name) => {
    const result = submissionBatchSchema.safeParse({
      projectId: PROJECT_ID,
      project: { id: PROJECT_ID, create: { ...validProject(), name } },
      overlays: [],
    });
    expect(result.success).toBeFalse();
  });
  test.each([
    { name: "Short" },
    { name: "" },
    { description: "x".repeat(2001) },
    { sourceUrl: "ftp://example.com" },
    { name: undefined },
    {},
    { lat: 48 },
  ])("rejects invalid edit %p", (patch) => {
    const result = submissionBatchSchema.safeParse({
      projectId: PROJECT_ID,
      project: { id: PROJECT_ID, patch },
      overlays: [],
    });
    expect(result.success).toBeFalse();
  });
  test("does not inject defaults or untouched fields into patches", () => {
    const result = submissionBatchSchema.parse({
      projectId: PROJECT_ID,
      project: { id: PROJECT_ID, patch: { description: "A correction" } },
      overlays: [],
    });
    expect(result.project).toEqual({ id: PROJECT_ID, patch: { description: "A correction" } });
  });
});
