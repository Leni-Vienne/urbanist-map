export const EXHAUSTED_STREAM = "exhausted" as const;

type FeedPosition = { date: string; id: string };
export type FeedStreamCursor = FeedPosition | typeof EXHAUSTED_STREAM;
export type FeedCursor = {
  overlay?: FeedStreamCursor | null;
  direct?: FeedStreamCursor | null;
  imported?: FeedStreamCursor | null;
};
export type FeedStreamName = "overlay" | "direct" | "imported";
export type FeedCursorRow = {
  stream: FeedStreamName;
  item: { id: string; updatedAt: Date | string };
};
export type FetchedCounts = Record<FeedStreamName, number | null>;

// A stream becomes exhausted only after every fetched row from its final short batch was emitted.
// Inactive and already-exhausted streams have a null fetched count and retain their cursor.
export function advanceFeedCursor(
  emitted: FeedCursorRow[],
  previous: FeedCursor | null | undefined,
  fetchedCounts: FetchedCounts,
  fetchSize: number,
): FeedCursor {
  const next: FeedCursor = {
    overlay: previous?.overlay ?? null,
    direct: previous?.direct ?? null,
    imported: previous?.imported ?? null,
  };

  for (const stream of ["overlay", "direct", "imported"] as const) {
    const fetchedCount = fetchedCounts[stream];
    if (fetchedCount === null) continue;

    const emittedRows = emitted.filter((row) => row.stream === stream);
    if (fetchedCount < fetchSize && emittedRows.length === fetchedCount) {
      next[stream] = EXHAUSTED_STREAM;
      continue;
    }

    const last = emittedRows.at(-1);
    if (last) {
      next[stream] = {
        date: new Date(last.item.updatedAt).toISOString(),
        id: last.item.id,
      };
    }
  }

  return next;
}
