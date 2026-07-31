import { describe, expect, test } from "bun:test";
import { advanceFeedCursor, EXHAUSTED_STREAM, type FeedCursorRow } from "./feedCursor";

describe("advanceFeedCursor", () => {
  test("marks a final emitted short batch as exhausted", () => {
    const emitted = [row("direct", "a", "2026-07-01T00:00:00.000Z")];

    expect(
      advanceFeedCursor(
        emitted,
        { overlay: EXHAUSTED_STREAM, imported: null },
        { overlay: null, direct: 1, imported: null },
        21,
      ),
    ).toEqual({
      overlay: EXHAUSTED_STREAM,
      direct: EXHAUSTED_STREAM,
      imported: null,
    });
  });

  test("does not exhaust a short batch while it still contains unconsumed rows", () => {
    const emitted = [row("imported", "b", "2026-06-01T00:00:00.000Z")];

    expect(
      advanceFeedCursor(emitted, null, { overlay: null, direct: null, imported: 10 }, 21).imported,
    ).toEqual({ date: "2026-06-01T00:00:00.000Z", id: "b" });
  });

  test("keeps a full batch resumable", () => {
    const emitted = [row("overlay", "c", "2026-05-01T00:00:00.000Z")];

    expect(
      advanceFeedCursor(emitted, null, { overlay: 21, direct: null, imported: null }, 21).overlay,
    ).toEqual({ date: "2026-05-01T00:00:00.000Z", id: "c" });
  });
});

function row(stream: FeedCursorRow["stream"], id: string, updatedAt: string): FeedCursorRow {
  return { stream, item: { id, updatedAt } };
}
