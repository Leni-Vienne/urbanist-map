class RateLimiter {
  private readonly hits = new Map<string, number[]>();
  private readonly cleanupInterval: ReturnType<typeof setInterval>;
  private readonly checkIntervalMs: number;

  constructor(checkIntervalMs = 60_000) {
    this.checkIntervalMs = checkIntervalMs;
    // Clean up expired entries periodically to prevent memory leaks
    this.cleanupInterval = setInterval(() => {
      this.cleanup();
    }, this.checkIntervalMs);
  }

  /**
   * Check if an IP has exceeded the limit within the window.
   * Returns true if allowed, false if limit exceeded.
   */
  /**
   * Check if an IP has exceeded the limit within the window.
   * Returns true if allowed, false if limit exceeded.
   * @param key - The identifier (e.g. IP address).
   * @param action - The specific action (e.g. 'login', 'upload'). If provided, limits are isolated per action.
   */
  check(ip: string, limit: number, windowMs: number, action = "default"): boolean {
    const key = `${ip}:${action}`;
    const now = Date.now();
    const timestamps = this.hits.get(key) ?? [];

    // Filter out timestamps outside the current window
    const validTimestamps = timestamps.filter((ts) => now - ts < windowMs);

    if (validTimestamps.length >= limit) {
      return false;
    }

    validTimestamps.push(now);
    this.hits.set(key, validTimestamps);
    return true;
  }

  /**
   * Get remaining requests for an IP.
   */
  getRemaining(ip: string, limit: number, windowMs: number, action = "default"): number {
    const key = `${ip}:${action}`;
    const now = Date.now();
    const timestamps = this.hits.get(key) ?? [];
    const validTimestamps = timestamps.filter((ts) => now - ts < windowMs);
    return Math.max(0, limit - validTimestamps.length);
  }

  private cleanup() {
    const now = Date.now();
    // Rate limiters usually have a max window of 1 hour, so we can safely remove anything older than that
    // To be safe, let's say 24 hours (86400000 ms) as a global cleanup threshold or just check emptiness
    // Actually, we can just iterate and remove empty arrays or very old entries.
    // A simple heuristic: if the array is empty or all timestamps are notably old.
    // Let's assume a safe max window of 1 hour for cleanup logic simplicity for now.
    const MAX_WINDOW = 3600 * 1000;

    for (const [key, timestamps] of this.hits.entries()) {
      const validTimestamps = timestamps.filter((ts) => now - ts < MAX_WINDOW);
      if (validTimestamps.length === 0) {
        this.hits.delete(key);
      } else {
        this.hits.set(key, validTimestamps);
      }
    }
  }

  // Call this when shutting down the server to allow clean exit
  stop() {
    clearInterval(this.cleanupInterval);
  }
}

// Export a singleton or allow instantiation? Let's export the class so we can have different limiters.
export const globalRateLimiter = new RateLimiter();
