/**
 * Invokes `func` on the leading edge, then at most once per `wait` ms while calls keep arriving,
 * with a trailing invocation after the last call so the final state is never missed. Unlike
 * debounce, it runs periodically DURING a burst of calls rather than only after it ends.
 */
export function throttle<T extends (...args: any[]) => any>(func: T, wait: number) {
  let lastRun = 0;
  let trailing: ReturnType<typeof setTimeout> | undefined = undefined;
  let lastArgs: Parameters<T> | undefined = undefined;

  function invoke(...args: Parameters<T>): void {
    lastArgs = args;
    const remaining = wait - (Date.now() - lastRun);
    if (remaining <= 0) {
      clearTimeout(trailing);
      trailing = undefined;
      lastRun = Date.now();
      func(...args);
    } else if (trailing === undefined) {
      trailing = setTimeout(() => {
        lastRun = Date.now();
        trailing = undefined;
        if (lastArgs) func(...lastArgs);
      }, remaining);
    }
  }

  function cancel(): void {
    clearTimeout(trailing);
    trailing = undefined;
    lastArgs = undefined;
  }

  return Object.assign(invoke, { cancel });
}
