// Share SDK loading across modal instances. A failed load stays retryable.
const pendingScripts = new Map<string, Promise<void>>();

export function loadProviderScript(src: string, isReady: () => boolean): Promise<void> {
  if (isReady()) return Promise.resolve();
  const pending = pendingScripts.get(src);
  if (pending) return pending;

  const promise = new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    function finish(error?: Error) {
      clearTimeout(timeout);
      script.removeEventListener("load", loaded);
      script.removeEventListener("error", failed);
      if (error) {
        script.remove();
        reject(error);
      } else {
        resolve();
      }
    }
    function loaded() {
      finish(isReady() ? undefined : new Error("Sign-in service unavailable"));
    }
    function failed() {
      finish(new Error("Failed to load sign-in service"));
    }
    const timeout = setTimeout(() => {
      finish(new Error("Sign-in service timed out"));
    }, 15_000);
    script.addEventListener("load", loaded);
    script.addEventListener("error", failed);
    document.head.append(script);
  });
  pendingScripts.set(src, promise);
  void promise.catch(() => pendingScripts.delete(src));
  return promise;
}
