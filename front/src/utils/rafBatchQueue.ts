export function createRafBatchQueue(process: (id: string) => void, batchSize: number) {
  const queue = new Set<string>();
  let rafId: number | null = null;

  function scheduleDrain() {
    rafId ??= requestAnimationFrame(drain);
  }

  function drain() {
    rafId = null;
    let count = 0;
    for (const id of queue) {
      if (count >= batchSize) break;
      process(id);
      queue.delete(id);
      count += 1;
    }
    if (queue.size > 0) scheduleDrain();
  }

  return {
    enqueue(id: string) {
      if (queue.has(id)) return;
      queue.add(id);
      scheduleDrain();
    },
    delete(id: string) {
      queue.delete(id);
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
