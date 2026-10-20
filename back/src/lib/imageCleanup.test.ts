import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import { LocalFileStorage } from "./storage";
import { deleteLocalImages } from "./imageCleanup";

afterEach(() => mock.restore());

describe("image deletion failures", () => {
  test("reports failed deletion instead of claiming success so cleanup can retry", async () => {
    const filename = `cleanup-test-${crypto.randomUUID()}.webp`;
    const deletion = spyOn(LocalFileStorage.prototype, "delete").mockRejectedValue(
      new Error("Storage unavailable"),
    );
    const failure = await deleteLocalImages(filename).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(AggregateError);
    expect(deletion.mock.calls).toContainEqual([filename]);
    expect(deletion.mock.calls).toContainEqual([`thumbnails/${filename}`]);
  });

  test("already missing files are safe to delete again", async () => {
    const filename = `cleanup-test-${crypto.randomUUID()}.webp`;
    await deleteLocalImages(filename);
  });
});
