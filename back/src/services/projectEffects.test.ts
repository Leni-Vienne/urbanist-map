import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import type { ProjectMapState } from "../db/projectMapState";

// These tests stub database execution and side effects, never opening a connection.
process.env.DATABASE_URL ??= "postgres://test:test@localhost:1/test";
process.env.CORS_ORIGIN ??= "http://localhost";
process.env.COOKIE_SECRET ??= "project-effects-test-secret-32-characters";
const [database, boundaries, indexable, tiles, feed, effects] = await Promise.all([
  import("../database"),
  import("../db/boundaryAssignment"),
  import("../db/indexable"),
  import("../routes/tiles"),
  import("../routes/feed"),
  import("./projectEffects"),
]);

afterEach(() => mock.restore());

const projectId = "11111111-1111-4111-8111-111111111111";
const oldBounds = { minLng: 2, minLat: 40, maxLng: 3, maxLat: 41 };
const newBounds = { minLng: 4, minLat: 42, maxLng: 5, maxLat: 43 };
const before: ProjectMapState = { projectIds: [projectId], bounds: [oldBounds] };

function stubEffects() {
  return {
    execute: spyOn(database.db, "execute").mockResolvedValue([newBounds]),
    boundary: spyOn(boundaries, "assignProjectBoundary").mockResolvedValue(undefined),
    indexable: spyOn(indexable, "refreshProjectIndexable").mockResolvedValue(undefined),
    tiles: spyOn(tiles, "invalidateTileBounds").mockImplementation(() => undefined),
    feed: spyOn(feed, "invalidateLatestContributionsCache").mockImplementation(() => undefined),
  };
}

describe("project post-commit effects", () => {
  test("refreshes boundary and SEO data and invalidates old and new locations", async () => {
    const calls = stubEffects();
    await effects.reconcileProjectChanges(before);
    expect(calls.boundary).toHaveBeenCalledWith(projectId);
    expect(calls.indexable).toHaveBeenCalledWith(projectId);
    expect(calls.tiles).toHaveBeenCalledWith([oldBounds, newBounds]);
    expect(calls.feed).toHaveBeenCalledTimes(1);
  });

  test("a deleted project's old extent is retained without a global cache clear", async () => {
    const calls = stubEffects();
    calls.execute.mockResolvedValue([]);
    await effects.reconcileProjectChanges(before);
    expect(calls.tiles).toHaveBeenCalledWith([oldBounds]);
  });

  test("one failed derived refresh does not suppress the others or fail the mutation", async () => {
    const calls = stubEffects();
    spyOn(console, "error").mockImplementation(() => undefined);
    calls.boundary.mockRejectedValue(new Error("Boundary refresh unavailable"));
    await effects.reconcileProjectChanges(before);
    expect(calls.indexable).toHaveBeenCalledWith(projectId);
    expect(calls.tiles).toHaveBeenCalledWith([oldBounds, newBounds]);
    expect(calls.feed).toHaveBeenCalledTimes(1);
  });

  test("a failed bounds read clears tile caches and still invalidates the feed", async () => {
    const calls = stubEffects();
    spyOn(console, "error").mockImplementation(() => undefined);
    calls.execute.mockRejectedValue(new Error("Database unavailable"));
    await effects.reconcileProjectChanges(before);
    expect(calls.tiles).toHaveBeenCalledWith(null);
    expect(calls.feed).toHaveBeenCalledTimes(1);
  });
});
