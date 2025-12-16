export class RateLimiter {
  private hits = new Map<string, number[]>();
  private cleanupInterval: ReturnType<typeof setInterval>;

  constructor(private checkIntervalMs = 60_000) {
    // AI : Clean up expired entries periodically to prevent memory leaks
    this.cleanupInterval = setInterval(() => this.cleanup(), this.checkIntervalMs);
  }

  /**
   * Check if an IP has exceeded the limit within the window.
   * Returns true if allowed, false if limit exceeded.
   */
  check(ip: string, limit: number, windowMs: number): boolean {
    const now = Date.now();
    const timestamps = this.hits.get(ip) || [];

    // AI : Filter out timestamps outside the current window
    const validTimestamps = timestamps.filter((ts) => now - ts < windowMs);

    if (validTimestamps.length >= limit) {
      return false;
    }

    validTimestamps.push(now);
    this.hits.set(ip, validTimestamps);
    return true;
  }

  /**
   * Get remaining requests for an IP.
   */
  getRemaining(ip: string, limit: number, windowMs: number): number {
    const now = Date.now();
    const timestamps = this.hits.get(ip) || [];
    const validTimestamps = timestamps.filter((ts) => now - ts < windowMs);
    return Math.max(0, limit - validTimestamps.length);
  }

  private cleanup() {
    const now = Date.now();
    // AI : Rate limiters usually have a max window of 1 hour, so we can safely remove anything older than that
    // to be safe, let's say 24 hours (86400000 ms) as a global cleanup threshold or just check emptiness
    // Actually, we can just iterate and remove empty arrays or very old entries.
    // A simple heuristic: if the array is empty or all timestamps are notably old.
    // Let's assume a safe max window of 1 hour for cleanup logic simplicity for now.
    const MAX_WINDOW = 3600 * 1000;

    for (const [ip, timestamps] of this.hits.entries()) {
      const validTimestamps = timestamps.filter((ts) => now - ts < MAX_WINDOW);
      if (validTimestamps.length === 0) {
        this.hits.delete(ip);
      } else {
        this.hits.set(ip, validTimestamps);
      }
    }
  }

  // AI : Call this when shutting down the server to allow clean exit
  stop() {
    clearInterval(this.cleanupInterval);
  }
}

// AI : Export a singleton or allow instantiation? Let's export the class so we can have different limiters.
export const globalRateLimiter = new RateLimiter();
