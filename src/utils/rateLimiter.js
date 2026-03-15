// Sliding-window rate limiter — 50 req/60s per key (configurable via env)

const DEFAULT_MAX = parseInt(process.env.RATE_LIMIT_MAX, 10) || 50;
const DEFAULT_WINDOW = parseInt(process.env.RATE_LIMIT_WINDOW_MS, 10) || 60_000;

class RateLimiter {
  constructor(maxRequests = DEFAULT_MAX, windowMs = DEFAULT_WINDOW) {
    this.maxRequests = maxRequests;
    this.windowMs = windowMs;
    this.requests = new Map();
  }

  // Check whether a request is allowed and record it if so
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

  reset(key) {
    this.requests.delete(key);
  }

  resetAll() {
    this.requests.clear();
  }
}

// Singleton instance used across the codebase for Roblox API calls
const robloxLimiter = new RateLimiter();

module.exports = { RateLimiter, robloxLimiter };
