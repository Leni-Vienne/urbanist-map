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
  let isRunning = false;

  function drain() {
    isRunning = true;
    let count = 0;
    for (const [key, value] of queue) {
      if (count >= batchSize) break;
      process(value, key);
      queue.delete(key);
      count += 1;
    }
    if (queue.size > 0) requestAnimationFrame(drain);
    else isRunning = false;
  }

  return {
    enqueue(key: string, value: T) {
      if (queue.has(key)) return;
      queue.set(key, value);
      if (!isRunning) drain();
    },
    delete(key: string) {
      queue.delete(key);
    },
    has(key: string): boolean {
      return queue.has(key);
    },
  };
}
