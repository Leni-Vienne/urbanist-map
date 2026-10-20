import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import { drizzle } from "drizzle-orm/pg-proxy";
import type { Transaction } from "../database";

// Queries run through a PostgreSQL proxy; these tests never open a database connection.
process.env.DATABASE_URL ??= "postgres://test:test@localhost:1/test";
process.env.CORS_ORIGIN ??= "http://localhost";
process.env.COOKIE_SECRET ??= "cleanup-test-secret-at-least-32-characters";
const [database, images, cleanup, logging] = await Promise.all([
  import("../database"),
  import("../lib/imageCleanup"),
  import("./cleanupService"),
  import("./logger"),
]);

afterEach(() => mock.restore());

const cutoff = new Date("2026-07-22T00:00:00Z");
const projectId = "11111111-1111-4111-8111-111111111111";

function stubTransaction(commit = true) {
  let committed = false;
  const proxy = drizzle(async (query) => {
    if (query.startsWith("select")) return { rows: [[projectId]] };
    if (query.includes('returning "filename"')) {
      return { rows: [["rejected.webp"], ["replaced.webp"], ["project-child.webp"]] };
    }
    return { rows: [] };
  });
  spyOn(database.db, "transaction").mockImplementation(async (work) => {
    // The proxy supplies the same query builders used here; the test controls commit separately.
    // oxlint-disable-next-line no-unsafe-type-assertion
    const result = await work(proxy as Transaction);
    if (!commit) throw new Error("Commit failed");
    committed = true;
    return result;
  });
  const deleted = spyOn(images, "deleteImagesEverywhere").mockImplementation(async () => {
    expect(committed).toBe(true);
  });
  return deleted;
}

describe("reviewed submission retention", () => {
  test("cleans up rejected, replaced and cascading project images only after commit", async () => {
    const deleted = stubTransaction();
    await cleanup.pruneReviewedSubmissions(cutoff);
    expect(deleted.mock.calls).toEqual([
      ["rejected.webp"],
      ["replaced.webp"],
      ["project-child.webp"],
    ]);
  });

  test("keeps every image when the database transaction fails", async () => {
    const deleted = stubTransaction(false);
    const failure = await cleanup.pruneReviewedSubmissions(cutoff).catch((error: unknown) => error);
    expect(failure).toHaveProperty("message", "Commit failed");
    expect(deleted).not.toHaveBeenCalled();
  });

  test("one image cleanup failure does not prevent the remaining images from being cleaned", async () => {
    const deleted = stubTransaction();
    deleted.mockRejectedValueOnce(new Error("Storage unavailable"));
    const logged = spyOn(logging.logger, "error").mockImplementation(() => undefined);
    await cleanup.pruneReviewedSubmissions(cutoff);
    expect(deleted).toHaveBeenCalledTimes(3);
    expect(logged).toHaveBeenCalledTimes(1);
  });
});
