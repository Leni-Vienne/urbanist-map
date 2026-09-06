import { beforeEach, describe, expect, test } from "bun:test";
import { createPinia, setActivePinia } from "pinia";
import { resolveShapeEditorGeometry } from "./shapeEditorLazy";
import { useAuthStore } from "@/stores/authStore";
import { useChangeRequestStore, type ChangeRequest } from "@/stores/changeRequestStore";
import { useProjectStore } from "@/stores/projectStore";
import { createLocalProject } from "@/utils/typeFactories";
import type { Project } from "@/types/index";

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
): ChangeRequest {
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

function activateFreshPinia(): void {
  setActivePinia(createPinia());
  useAuthStore().user = {
    id: "user-1",
    email: "user@example.com",
    username: "user",
    role: null,
    moderatedCountries: [],
    emailVerified: true,
  };
}

function seedPersistedProject(geometry: GeoJSON.GeometryCollection | null): void {
  useProjectStore().upsertProjectSummary(makePersistedProject(geometry));
}

beforeEach(activateFreshPinia);

function usesPersistedGeometry(): void {
  const baseline = makeGeometry(0);
  seedPersistedProject(baseline);

  expect(resolveShapeEditorGeometry("project-1")).toEqual(baseline);
}

function usesPendingGeometry(): void {
  const pending = makeGeometry(10);
  seedPersistedProject(makeGeometry(0));
  useChangeRequestStore().setPendingChangeRequests([makeGeometryChange(pending)]);

  expect(resolveShapeEditorGeometry("project-1")).toEqual(pending);
}

function usesExplicitGeometryDraft(): void {
  const draft = makeGeometry(20);
  seedPersistedProject(makeGeometry(0));
  useChangeRequestStore().setPendingChangeRequests([makeGeometryChange(makeGeometry(10))]);
  useProjectStore().updateProjectDraft("project-1", { geometry: draft });

  expect(resolveShapeEditorGeometry("project-1")).toEqual(draft);
}

function preservesExplicitNullDraft(): void {
  seedPersistedProject(makeGeometry(0));
  useChangeRequestStore().setPendingChangeRequests([makeGeometryChange(makeGeometry(10))]);
  useProjectStore().updateProjectDraft("project-1", { geometry: null });

  expect(resolveShapeEditorGeometry("project-1")).toBeNull();
}

function ignoresUnrelatedDraft(): void {
  const pending = makeGeometry(10);
  seedPersistedProject(makeGeometry(0));
  useChangeRequestStore().setPendingChangeRequests([makeGeometryChange(pending)]);
  useProjectStore().updateProjectDraft("project-1", { name: "Draft name" });

  expect(resolveShapeEditorGeometry("project-1")).toEqual(pending);
}

function usesLocalProjectGeometry(): void {
  const local = makeGeometry(30);
  useProjectStore().addLocalProject(createLocalProject({ id: "project-1", geometry: local }));
  useChangeRequestStore().setPendingChangeRequests([makeGeometryChange(makeGeometry(10))]);

  expect(resolveShapeEditorGeometry("project-1")).toEqual(local);
}

function shapeEditorGeometryOwnership(): void {
  test("uses persisted geometry when no draft or pending proposal exists", usesPersistedGeometry);
  test(
    "uses the current user's pending geometry proposal over persisted geometry",
    usesPendingGeometry,
  );
  test("uses an explicit geometry draft over a pending proposal", usesExplicitGeometryDraft);
  test("preserves an explicit null geometry draft", preservesExplicitNullDraft);
  test("does not let an unrelated draft hide a pending geometry proposal", ignoresUnrelatedDraft);
  test("uses the base geometry owned by a new local project", usesLocalProjectGeometry);
}

describe("shape editor geometry ownership", shapeEditorGeometryOwnership);
