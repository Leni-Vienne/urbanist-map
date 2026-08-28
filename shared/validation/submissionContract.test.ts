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
    project: validProject(),
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
  const project = { ...validProject(), changedFields: ["name", "name"] };
  const result = submissionBatchSchema.safeParse({
    projectId: PROJECT_ID,
    project,
    overlays: [],
  });

  expect(result.success).toBeFalse();
}

function submissionIntentContract() {
  test("accepts effective values plus user-touched fields", acceptsIntent);
  test("rejects the removed frontend-classified change-request bucket", rejectsOldBucket);
  test("rejects duplicate changed fields", rejectsDuplicateFields);
}

describe("submission intent contract", submissionIntentContract);
