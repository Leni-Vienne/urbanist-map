const CLEANUP_INTERVAL_MS = 60_000;
const MAX_WINDOW_MS = 3600 * 1000;

const hits = new Map<string, number[]>();

/**
 * Check if an identifier has exceeded the limit within the window.
 * Returns true if allowed, false if limit exceeded.
 * Callers isolate scopes by prefixing the identifier (e.g. `delete:${ip}`, `export:${userId}`).
 */
export function check(identifier: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const timestamps = hits.get(identifier) ?? [];

  const validTimestamps = timestamps.filter((ts) => now - ts < windowMs);

  if (validTimestamps.length >= limit) {
    return false;
  }

  validTimestamps.push(now);
  hits.set(identifier, validTimestamps);
  return true;
}

function cleanup(): void {
  const now = Date.now();
  for (const [key, timestamps] of hits.entries()) {
    const validTimestamps = timestamps.filter((ts) => now - ts < MAX_WINDOW_MS);
    if (validTimestamps.length === 0) {
      hits.delete(key);
    } else {
      hits.set(key, validTimestamps);
    }
  }
}

setInterval(cleanup, CLEANUP_INTERVAL_MS);
