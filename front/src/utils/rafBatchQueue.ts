/**
 * A keyed queue drained in animation-frame-sized batches.
 * Prevents long main-thread blocks when many similar operations are scheduled at once
 * (e.g. bulk overlay teardown on mode switch, or simultaneous cached-image load callbacks).
 *
 * Re-enqueueing an existing key is a no-op.
 */
export function createRafBatchQueue<T>(
  process: (value: T, key: string) => void,
  batchSize: number,
) {
  const queue = new Map<string, T>();
  let rafId: number | null = null;

  function scheduleDrain() {
    if (rafId === null) rafId = requestAnimationFrame(drain);
  }

  function drain() {
    rafId = null;
    let count = 0;
    for (const [key, value] of queue) {
      if (count >= batchSize) break;
      process(value, key);
      queue.delete(key);
      count += 1;
    }
    if (queue.size > 0) scheduleDrain();
  }

  return {
    enqueue(key: string, value: T) {
      if (queue.has(key)) return;
      queue.set(key, value);
      scheduleDrain();
    },
    delete(key: string) {
      queue.delete(key);
    },
    has(key: string): boolean {
      return queue.has(key);
    },
    /** Discard everything still queued and cancel the pending drain frame. */
    clear() {
      queue.clear();
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
    },
  };
}
