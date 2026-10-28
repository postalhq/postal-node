import type { RateLimit } from './rate-limit.js'

/**
 * Error body of the Postal API: `{ statusCode, name, message }`.
 */
export interface PostalErrorBody {
  statusCode: number
  name: string
  message: string
  [key: string]: unknown
}

/**
 * Error returned by the Postal API (any status outside 2xx).
 *
 * `name` and `message` are Postal's: `name` is the stable code in English
 * (`validation_error`, `rate_limit_exceeded`, `invalid_api_key`...) and should be
 * used to handle the error in code; `message` is for people and may change.
 */
export class PostalError extends Error {
  /** HTTP status of the response (0 when there was no response). */
  readonly statusCode: number
  /** Seconds Postal asked for in `Retry-After`, if it came. */
  readonly retryAfter: number | undefined
  /** Extra fields of the error body (for example `errors`). */
  readonly body: PostalErrorBody | undefined
  /** The request limit from the response headers (on a 429, with `retryAfter`), if it came. */
  readonly rateLimit: RateLimit | null

  constructor(
    statusCode: number,
    name: string,
    message: string,
    extra: { retryAfter?: number; body?: PostalErrorBody; rateLimit?: RateLimit | null } = {},
  ) {
    super(message)
    this.name = name
    this.statusCode = statusCode
    this.retryAfter = extra.retryAfter
    this.body = extra.body
    this.rateLimit = extra.rateLimit ?? null
  }

  /** Alias of `name`, for whoever prefers `error.code`. */
  get code(): string {
    return this.name
  }

  toJSON(): { statusCode: number; name: string; message: string } {
    return { statusCode: this.statusCode, name: this.name, message: this.message }
  }
}

/**
 * Network failure or timeout: the API did not get to answer.
 * `statusCode` is 0 and `name` is `network_error`, `timeout` (the API accepted the connection but did not answer in
 * time) or `connect_timeout` (the connection could not be opened in time).
 */
export class PostalNetworkError extends PostalError {
  override readonly cause: unknown

  constructor(name: 'network_error' | 'timeout' | 'connect_timeout', message: string, cause?: unknown) {
    super(0, name, message)
    this.cause = cause
  }
}

/**
 * A webhook signature does not match (`name`: `webhook_verification_failed`).
 */
export class PostalWebhookVerificationError extends PostalError {
  constructor(message: string) {
    super(400, 'webhook_verification_failed', message)
  }
}

/**
 * Tells whether a value is a Postal error, even when it comes from another copy of the package.
 */
export function isPostalError(value: unknown): value is PostalError {
  return (
    value instanceof PostalError ||
    (value instanceof Error &&
      typeof (value as { statusCode?: unknown }).statusCode === 'number' &&
      'retryAfter' in value)
  )
}
