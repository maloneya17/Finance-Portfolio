import { Ratelimit } from '@upstash/ratelimit'
import { Redis } from '@upstash/redis'

// ─── In-memory fallback (development / single-instance) ───────────────────────
interface RateLimitEntry { count: number; windowStart: number }
const memStore = new Map<string, RateLimitEntry>()

function memRateLimit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now()
  const entry = memStore.get(key)
  if (!entry || now - entry.windowStart >= windowMs) {
    memStore.set(key, { count: 1, windowStart: now })
    // Prune stale entries to prevent unbounded growth
    for (const [k, v] of memStore) {
      if (v.windowStart + windowMs < now) memStore.delete(k)
    }
    return true
  }
  if (entry.count >= limit) return false
  entry.count += 1
  return true
}

// ─── Upstash Redis rate limiter (production / multi-instance) ─────────────────
// Requires UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN env vars.
// Falls back to in-memory when they are not set (e.g. local development).
let redisLimiterCache: Map<string, Ratelimit> | null = null

function getRedisLimiter(limit: number, windowMs: number): Ratelimit | null {
  if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) {
    return null
  }
  const cacheKey = `${limit}:${windowMs}`
  if (!redisLimiterCache) redisLimiterCache = new Map()
  if (!redisLimiterCache.has(cacheKey)) {
    const redis = new Redis({
      url:   process.env.UPSTASH_REDIS_REST_URL,
      token: process.env.UPSTASH_REDIS_REST_TOKEN,
    })
    redisLimiterCache.set(
      cacheKey,
      new Ratelimit({
        redis,
        limiter: Ratelimit.slidingWindow(limit, `${windowMs} ms`),
        prefix: 'rl',
      }),
    )
  }
  return redisLimiterCache.get(cacheKey)!
}

/**
 * Rate limiter that uses Upstash Redis in production (shared across all
 * instances) and falls back to an in-memory store in development.
 *
 * Returns true if the request is allowed, false if rate-limited.
 *
 * Keys should be namespaced by route to avoid bucket collisions:
 *   rateLimit(`checkout:${userId}`, 5, 60_000)
 *   rateLimit(`delete:${userId}`,   3, 300_000)
 */
export async function rateLimit(key: string, limit: number, windowMs: number): Promise<boolean> {
  const limiter = getRedisLimiter(limit, windowMs)
  if (limiter) {
    const { success } = await limiter.limit(key)
    return success
  }
  return memRateLimit(key, limit, windowMs)
}
