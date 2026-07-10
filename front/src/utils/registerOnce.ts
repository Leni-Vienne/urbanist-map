/** Wrap a function so it runs on the first call and no-ops on every call after. */
export function registerOnce(register: () => void): () => void {
  let hasRegistered = false;
  return function runRegistrationOnce(): void {
    if (hasRegistered) return;
    hasRegistered = true;
    register();
  };
}
