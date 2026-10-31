import { beforeEach, describe, expect, test } from "bun:test";
import { createPinia, setActivePinia } from "pinia";
import { resolveShapeEditorGeometry } from "./shapeEditorLazy";
import { useAuthStore } from "@/stores/authStore";
import { useChangeRequestStore } from "@/stores/changeRequestStore";
import { useProjectStore } from "@/stores/projectStore";
import { createLocalProject } from "@/utils/typeFactories";
import type { Project, PendingChangeRequest } from "@/types/index";
import { changeRequestFromWire } from "@/services/changes/changeRequestData";

function makeGeometry(offset: number): GeoJSON.GeometryCollection {
  return {
    type: "GeometryCollection",
    geometries: [
      {
        type: "LineString",
        coordinates: [
          [offset, offset],
          [offset + 1, offset + 1],
        ],
      },
    ],
  };
}

function makePersistedProject(geometry: GeoJSON.GeometryCollection | null): Project {
  return {
    ...createLocalProject({ id: "project-1", geometry }),
    status: "approved",
  };
}

function makeGeometryChange(
  geometry: GeoJSON.GeometryCollection | null,
  requestedBy = "user-1",
): PendingChangeRequest {
  return {
    id: "geometry-change",
    entityType: "project",
    entityId: "project-1",
    fieldName: "geometry",
    oldValue: null,
    newValue: geometry,
    changeReason: null,
    status: "pending",
    requestedBy,
    requestedByUsername: "user",
    requestedByReportCount: 0,
    createdAt: new Date(0),
    hasConflict: false,
  };
}

beforeEach(() => {
  setActivePinia(createPinia());
  useAuthStore().user = {
    id: "user-1",
    email: "user@example.com",
    username: "user",
    role: null,
    moderatedCountries: [],
    emailVerified: true,
  };
});

function seedPersistedProject(geometry: GeoJSON.GeometryCollection | null): void {
  useProjectStore().upsertProjectSummary(makePersistedProject(geometry));
}

describe("shape editor geometry ownership", () => {
  test("uses persisted geometry when no draft or pending proposal exists", () => {
    const baseline = makeGeometry(0);
    seedPersistedProject(baseline);

    expect(resolveShapeEditorGeometry("project-1")).toEqual(baseline);
  });

  test("uses the current user's pending geometry proposal over persisted geometry", () => {
    const pending = makeGeometry(10);
    seedPersistedProject(makeGeometry(0));
    useChangeRequestStore().setPendingChangeRequests([makeGeometryChange(pending)]);

    expect(resolveShapeEditorGeometry("project-1")).toEqual(pending);
  });

  test("uses an explicit geometry draft over a pending proposal", () => {
    const draft = makeGeometry(20);
    seedPersistedProject(makeGeometry(0));
    useChangeRequestStore().setPendingChangeRequests([makeGeometryChange(makeGeometry(10))]);
    useProjectStore().updateProjectDraft("project-1", { geometry: draft });

    expect(resolveShapeEditorGeometry("project-1")).toEqual(draft);
  });

  test("preserves an explicit null geometry draft", () => {
    seedPersistedProject(makeGeometry(0));
    useChangeRequestStore().setPendingChangeRequests([makeGeometryChange(makeGeometry(10))]);
    useProjectStore().updateProjectDraft("project-1", { geometry: null });

    expect(resolveShapeEditorGeometry("project-1")).toBeNull();
  });

  test("does not let an unrelated draft hide a pending geometry proposal", () => {
    const pending = makeGeometry(10);
    seedPersistedProject(makeGeometry(0));
    useChangeRequestStore().setPendingChangeRequests([makeGeometryChange(pending)]);
    useProjectStore().updateProjectDraft("project-1", { name: "Draft name" });

    expect(resolveShapeEditorGeometry("project-1")).toEqual(pending);
  });

  test("uses the base geometry owned by a new local project", () => {
    const local = makeGeometry(30);
    useProjectStore().addLocalProject(createLocalProject({ id: "project-1", geometry: local }));
    useChangeRequestStore().setPendingChangeRequests([makeGeometryChange(makeGeometry(10))]);

    expect(resolveShapeEditorGeometry("project-1")).toEqual(local);
  });

  test("preserves a pending removal of all shapes", () => {
    seedPersistedProject(makeGeometry(0));
    useChangeRequestStore().setPendingChangeRequests([makeGeometryChange(null)]);
    expect(resolveShapeEditorGeometry("project-1")).toBeNull();
  });

  test("falls back to approved shapes for malformed pending geometry", () => {
    const baseline = makeGeometry(0);
    seedPersistedProject(baseline);
    useChangeRequestStore().setPendingChangeRequests([
      changeRequestFromWire({
        ...makeGeometryChange(null),
        newValue: {
          type: "GeometryCollection",
          geometries: [{ type: "LineString", coordinates: null }],
        },
      }),
    ]);
    expect(resolveShapeEditorGeometry("project-1")).toEqual(baseline);
  });
});
