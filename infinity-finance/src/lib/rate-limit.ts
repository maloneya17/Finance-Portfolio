interface RateLimitEntry {
  count: number
  windowStart: number
}

const store = new Map<string, RateLimitEntry>()

/**
 * Simple in-memory rate limiter (per-instance, best-effort).
 * Returns true if the request is allowed, false if rate limited.
 *
 * @param key       - Unique identifier for the caller (e.g. user ID)
 * @param limit     - Maximum number of requests allowed within the window
 * @param windowMs  - Duration of the sliding window in milliseconds
 */
export function rateLimit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now()
  const entry = store.get(key)

  if (!entry || now - entry.windowStart >= windowMs) {
    // No existing entry or the window has expired — start a fresh window
    store.set(key, { count: 1, windowStart: now })
    return true
  }

  if (entry.count >= limit) {
    return false
  }

  entry.count += 1
  return true
}
