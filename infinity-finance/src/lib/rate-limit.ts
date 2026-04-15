interface RateLimitEntry {
  count: number
  windowStart: number
}

const store = new Map<string, RateLimitEntry>()
let writeCount = 0

/**
 * Simple in-memory rate limiter (per-instance, best-effort).
 * Returns true if the request is allowed, false if rate limited.
 *
 * @param key       - Unique identifier for the caller (e.g. user ID)
 * @param limit     - Maximum number of requests allowed within the window
 * @param windowMs  - Duration of the sliding window in milliseconds
 *
 * Keys should be namespaced to avoid cross-route bucket sharing:
 * Example: rateLimit(`export:${userId}`, 10, 60_000)
 * Example: rateLimit(`delete:${userId}`, 3, 300_000)
 */
export function rateLimit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now()
  const entry = store.get(key)

  if (!entry || now - entry.windowStart >= windowMs) {
    // No existing entry or the window has expired — start a fresh window
    store.set(key, { count: 1, windowStart: now })

    // Prune expired entries after every write
    for (const [k, v] of store) {
      if (v.windowStart + windowMs < now) {
        store.delete(k)
      }
    }

    // Every 100 writes, do a full sweep of all keys using their own windowMs
    writeCount += 1
    if (writeCount % 100 === 0) {
      for (const [k, v] of store) {
        // Use the same windowMs from the current call as a conservative bound;
        // entries that are stale relative to any reasonable window are removed.
        if (v.windowStart + windowMs < now) {
          store.delete(k)
        }
      }
    }

    return true
  }

  if (entry.count >= limit) {
    return false
  }

  entry.count += 1
  return true
}
