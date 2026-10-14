import { beforeEach, describe, expect, test } from "bun:test";
import { createPinia, setActivePinia } from "pinia";
import { useChangeRequestStore } from "@/stores/changeRequestStore";
import { useFocusStore } from "@/stores/focusStore";
import { useModerationStore } from "@/stores/moderationStore";
import { changeRequestFromWire } from "@/services/changes/changeRequestData";
import type { PendingChangeRequest } from "@/types/index";

function activateFreshPinia(): void {
  setActivePinia(createPinia());
}

function makeProjectGeometryChange(projectId: string): PendingChangeRequest {
  return {
    id: `change-${projectId}`,
    entityType: "project",
    entityId: projectId,
    fieldName: "geometry",
    oldValue: null,
    newValue: null,
    changeReason: null,
    status: "pending",
    requestedBy: "user-1",
    requestedByUsername: "user",
    requestedByReportCount: 0,
    createdAt: new Date(0),
    hasConflict: false,
  };
}

function projectPreviewFollowsSelection(): void {
  const changeRequestStore = useChangeRequestStore();
  const focusStore = useFocusStore();
  changeRequestStore.setPendingChangeRequests([
    makeProjectGeometryChange("project-1"),
    makeProjectGeometryChange("project-2"),
  ]);

  focusStore.setSelectionTarget({ kind: "project", projectId: "project-2" });
  expect(changeRequestStore.previewState).toEqual({
    type: "project-current",
    changeId: "change-project-2",
    projectId: "project-2",
  });

  changeRequestStore.previewIntent = {
    changeId: "change-project-1",
    side: "suggested",
  };
  expect(changeRequestStore.previewState).toEqual({
    type: "project-current",
    changeId: "change-project-2",
    projectId: "project-2",
  });

  changeRequestStore.previewIntent = {
    changeId: "change-project-2",
    side: "suggested",
  };
  expect(changeRequestStore.previewState).toEqual({
    type: "project-suggested",
    changeId: "change-project-2",
    projectId: "project-2",
  });

  focusStore.setSelectionTarget(null);
  expect(changeRequestStore.previewState).toEqual({ type: "none" });

  focusStore.setSelectionTarget({ kind: "project", projectId: "project-without-change" });
  expect(changeRequestStore.previewState).toEqual({ type: "none" });
}

beforeEach(activateFreshPinia);
function changeRequestPreviewOwnership(): void {
  test("scopes project geometry previews to the selected project", projectPreviewFollowsSelection);
  test("stores decoded moderation geometry while preserving intentional removals", () => {
    const valid = makeProjectGeometryChange("project-1");
    const invalid = {
      ...makeProjectGeometryChange("project-2"),
      newValue: {
        type: "GeometryCollection",
        geometries: [{ type: "LineString", coordinates: null }],
      },
    };
    const store = useModerationStore();
    store.setModerationData({
      projectIds: [],
      overlaysById: {},
      changeRequests: [valid, invalid].map(changeRequestFromWire),
    });
    expect(store.changeRequests[0]?.newValue).toBeNull();
    expect(store.changeRequests[1]?.newValue).toBeUndefined();
    expect(invalid.newValue).toBeDefined();
  });
}

describe("change request preview ownership", changeRequestPreviewOwnership);
