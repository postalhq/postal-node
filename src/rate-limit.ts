/**
 * Requests-per-second limit read from the headers of a Postal response.
 *
 * Every response carries `X-RateLimit-Limit` and `X-RateLimit-Remaining`; a `429` also carries `Retry-After` and
 * `X-RateLimit-Reset`. Missing fields are `null`. It does not need a full-access key (unlike
 * `usage()`) and makes no extra request.
 */
export interface RateLimit {
  /** Requests allowed per second (`X-RateLimit-Limit`). */
  limit: number | null
  /** How many still fit in the current window (`X-RateLimit-Remaining`). */
  remaining: number | null
  /** Seconds to wait before trying again (`Retry-After`, only on a 429). */
  retryAfter: number | null
  /** When the limit comes back, as a Unix timestamp in seconds (`X-RateLimit-Reset`, only on a 429). */
  resetAt: number | null
}

function integer(value: string | null): number | null {
  const trimmed = value?.trim()

  return trimmed !== undefined && /^\d+$/.test(trimmed) ? Number(trimmed) : null
}

/**
 * Reads the headers of a response. Returns `null` when none of the four came.
 */
export function parseRateLimit(headers: Headers): RateLimit | null {
  const rateLimit: RateLimit = {
    limit: integer(headers.get('x-ratelimit-limit')),
    remaining: integer(headers.get('x-ratelimit-remaining')),
    retryAfter: integer(headers.get('retry-after')),
    resetAt: integer(headers.get('x-ratelimit-reset')),
  }

  return Object.values(rateLimit).every((value) => value === null) ? null : rateLimit
}
