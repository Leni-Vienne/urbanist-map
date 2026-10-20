import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import { mkdir, truncate, unlink } from "node:fs/promises";
import { drizzle } from "drizzle-orm/pg-proxy";

process.env.DATABASE_URL ??= "postgres://test:test@localhost:1/test";
process.env.CORS_ORIGIN ??= "http://localhost";
process.env.COOKIE_SECRET ??= "storage-quota-test-secret-at-least-32-characters";
const [{ db }, { exceedsPendingStorageQuota }] = await Promise.all([
  import("../database"),
  import("./storageQuota"),
]);
const filename = `quota-test-${crypto.randomUUID()}.webp`;
const originalFilename = filename.replace(".webp", ".png");
const paths = [
  `./uploads/${filename}`,
  `./uploads/thumbnails/${filename}`,
  `./uploads/originals/${originalFilename}`,
] as const;

afterEach(async () => {
  mock.restore();
  await Promise.all(
    paths.map(async (path) => {
      try {
        await unlink(path);
      } catch (error) {
        // Tests that never write fixtures have nothing to remove.
        if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
      }
    }),
  );
});

function stubUsageQuery(fail = false) {
  const proxy = drizzle(async (_query, params) => {
    if (fail) throw new Error("Usage query unavailable");
    expect(params).toContain("pending");
    expect(params).toContain("rejected");
    expect(params).not.toContain("approved");
    expect(params).not.toContain("replaced");
    return { rows: [[filename, originalFilename]] };
  });
  // The proxy uses the same select builder and row mapping, without opening a connection.
  spyOn(db, "select").mockImplementation(proxy.select.bind(proxy));
}

describe("upload storage quota", () => {
  test("charges retained rejected uploads, including originals and thumbnails", async () => {
    stubUsageQuery();
    await mkdir("./uploads/thumbnails", { recursive: true });
    await mkdir("./uploads/originals", { recursive: true });
    for (const path of paths) await Bun.write(path, "");
    // Sparse files exercise actual disk accounting without allocating 200 MB of test data.
    await truncate(paths[0], 100 * 1024 * 1024);
    await truncate(paths[1], 100);
    await truncate(paths[2], 100 * 1024 * 1024 - 100);
    expect(await exceedsPendingStorageQuota("user-1", 0)).toBe(false);
    expect(await exceedsPendingStorageQuota("user-1", 1)).toBe(true);
  });

  test("missing files do not consume quota after successful cleanup", async () => {
    stubUsageQuery();
    expect(await exceedsPendingStorageQuota("user-1", 1)).toBe(false);
  });

  test("a failed usage query cannot disable the quota", async () => {
    stubUsageQuery(true);
    const failure = await exceedsPendingStorageQuota("user-1", 1).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(Error);
  });
});
