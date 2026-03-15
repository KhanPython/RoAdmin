/**
 * Sliding Window Rate Limiter
 * Tracks request timestamps per key and rejects when the window is full.
 *
 * Default: 50 requests per 60 seconds per key (conservative for Roblox Open Cloud).
 * Override defaults via RATE_LIMIT_MAX and RATE_LIMIT_WINDOW_MS env vars.
 */

const DEFAULT_MAX = parseInt(process.env.RATE_LIMIT_MAX, 10) || 50;
const DEFAULT_WINDOW = parseInt(process.env.RATE_LIMIT_WINDOW_MS, 10) || 60_000;

class RateLimiter {
  /**
   * @param {number} maxRequests - Maximum requests allowed in the window
   * @param {number} windowMs - Window duration in milliseconds
   */
  constructor(maxRequests = DEFAULT_MAX, windowMs = DEFAULT_WINDOW) {
    this.maxRequests = maxRequests;
    this.windowMs = windowMs;
    /** @type {Map<string, number[]>} key → sorted timestamps */
    this.requests = new Map();
  }

  /**
   * Check whether a request is allowed and record it if so.
   * @param {string} key - Bucket key (e.g. "universe:12345")
   * @returns {{ allowed: boolean, retryAfter: number }} retryAfter in ms (0 if allowed)
   */
  check(key) {
    const now = Date.now();
    const timestamps = this.requests.get(key) || [];

    // Evict expired entries
    const cutoff = now - this.windowMs;
    const valid = timestamps.filter(t => t > cutoff);

    if (valid.length >= this.maxRequests) {
      const retryAfter = valid[0] - cutoff;
      this.requests.set(key, valid);
      return { allowed: false, retryAfter };
    }

    valid.push(now);
    this.requests.set(key, valid);
    return { allowed: true, retryAfter: 0 };
  }

  /**
   * Remove all tracked timestamps for a key.
   * @param {string} key
   */
  reset(key) {
    this.requests.delete(key);
  }

  /** Remove all tracked state. */
  resetAll() {
    this.requests.clear();
  }
}

// Singleton instance used across the codebase for Roblox API calls
const robloxLimiter = new RateLimiter();

module.exports = { RateLimiter, robloxLimiter };
