// Sliding-window rate limiter - 50 req/60s per key (configurable via env)

const DEFAULT_MAX = parseInt(process.env.RATE_LIMIT_MAX, 10) || 50;
const DEFAULT_WINDOW = parseInt(process.env.RATE_LIMIT_WINDOW_MS, 10) || 60_000;
const MAX_KEYS = 10_000;
const SWEEP_INTERVAL_MS = 60_000;

class RateLimiter {
  constructor(maxRequests = DEFAULT_MAX, windowMs = DEFAULT_WINDOW) {
    this.maxRequests = maxRequests;
    this.windowMs = windowMs;
    this.requests = new Map();

    // Periodically purge entries whose timestamps have all expired
    this._sweeper = setInterval(() => this._sweep(), SWEEP_INTERVAL_MS);
    if (this._sweeper.unref) this._sweeper.unref(); // don't block process exit
  }

  _sweep() {
    const cutoff = Date.now() - this.windowMs;
    for (const [key, timestamps] of this.requests) {
      const valid = timestamps.filter(t => t > cutoff);
      if (valid.length === 0) {
        this.requests.delete(key);
      } else if (valid.length < timestamps.length) {
        this.requests.set(key, valid);
      }
    }
  }

  // Check whether a request is allowed and record it if so
  check(key) {
    // Hard cap on tracked keys to prevent memory exhaustion
    if (!this.requests.has(key) && this.requests.size >= MAX_KEYS) {
      return { allowed: false, retryAfter: this.windowMs };
    }

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
