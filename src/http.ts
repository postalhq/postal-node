import { canWatchConnection, watchConnection } from './connect-timeout.js'
import { PostalError, PostalNetworkError, type PostalErrorBody } from './errors.js'
import { parseRateLimit, type RateLimit } from './rate-limit.js'

export const DEFAULT_BASE_URL = 'https://api.postal.so'
export const VERSION = '0.1.0'

export type Fetch = (input: string, init?: RequestInit) => Promise<Response>

export interface ClientOptions {
  /** API key (`ps_...`). Default: the `POSTAL_API_KEY` environment variable. */
  apiKey?: string
  /** Base URL of the API. Default: `https://api.postal.so`. */
  baseUrl?: string
  /** Extra attempts on 429 and 5xx. Default: 2. Use 0 to turn off. */
  maxRetries?: number
  /** Maximum time of each attempt, from start to finish, in milliseconds. Default: 30000. */
  timeout?: number
  /**
   * Maximum time just to open the connection (DNS, TCP and TLS), in milliseconds. Default: 5000; 0 turns it off.
   * Only applied with Node's global `fetch`; with your own `fetch` only `timeout` counts.
   * With the API down, a call blocks about `(maxRetries + 1) × connectTimeout` plus the waits.
   */
  connectTimeout?: number
  /** Base wait between attempts, in milliseconds (doubles on every attempt). Default: 500. */
  retryDelay?: number
  /** `fetch` implementation. Default: the global `fetch`. */
  fetch?: Fetch
  /** Text appended to the `User-Agent`. */
  userAgent?: string
}

export interface RequestOptions {
  /** Idempotency key (1 to 256 characters) of `POST /emails`, `/emails/batch` and `/events`. */
  idempotencyKey?: string
  /** Cancels the request. */
  signal?: AbortSignal
}

export type QueryValue = string | number | boolean | null | undefined | readonly (string | number)[]

interface InternalRequest {
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'
  path: string
  query?: object
  body?: unknown
  options?: RequestOptions
  /** Marks POST/PATCH calls that can be repeated without a duplicate effect (upsert). */
  idempotent?: boolean
  /** Generates an idempotency key for the send, reused across attempts. */
  autoIdempotency?: boolean
}

const MAX_RETRY_DELAY_MS = 30_000

/**
 * Minimal HTTP client: authentication, JSON, typed errors and retries.
 * Used by all resources; not part of the public API.
 */
export class HttpClient {
  readonly baseUrl: string
  private readonly apiKey: string
  private readonly maxRetries: number
  private readonly timeout: number
  private readonly connectTimeout: number
  private readonly retryDelay: number
  private readonly fetchImpl: Fetch
  private readonly watchesConnection: boolean
  private readonly userAgent: string
  private lastRateLimit: RateLimit | null = null

  constructor(options: ClientOptions) {
    const apiKey = options.apiKey ?? process.env['POSTAL_API_KEY']

    if (!apiKey) {
      throw new PostalError(
        0,
        'missing_api_key',
        'Provide the API key: new Postal("ps_...") or the POSTAL_API_KEY environment variable.',
      )
    }

    this.apiKey = apiKey
    this.baseUrl = (options.baseUrl ?? process.env['POSTAL_API_URL'] ?? DEFAULT_BASE_URL).replace(/\/+$/, '')
    this.maxRetries = Math.max(0, options.maxRetries ?? 2)
    this.timeout = options.timeout ?? 30_000
    this.connectTimeout = Math.max(0, options.connectTimeout ?? 5_000)
    this.retryDelay = Math.max(0, options.retryDelay ?? 500)
    this.fetchImpl = options.fetch ?? ((input, init) => fetch(input, init))
    this.watchesConnection = options.fetch === undefined && canWatchConnection()
    this.userAgent = `postal-so-node/${VERSION}${options.userAgent ? ` ${options.userAgent}` : ''}`
  }

  /** The request limit of the last response that carried it (see `Postal.rateLimit`). */
  get rateLimit(): RateLimit | null {
    return this.lastRateLimit
  }

  get<T>(path: string, query?: object, options?: RequestOptions): Promise<T> {
    return this.request<T>({ method: 'GET', path, query, options })
  }

  post<T>(path: string, body?: unknown, extra: Partial<InternalRequest> = {}): Promise<T> {
    return this.request<T>({ method: 'POST', path, body, ...extra })
  }

  patch<T>(path: string, body?: unknown, extra: Partial<InternalRequest> = {}): Promise<T> {
    return this.request<T>({ method: 'PATCH', path, body, ...extra })
  }

  delete<T>(path: string, options?: RequestOptions): Promise<T> {
    return this.request<T>({ method: 'DELETE', path, options })
  }

  /**
   * Returns the body as text (for `GET /emails/{id}/raw`).
   */
  async getText(path: string, options?: RequestOptions): Promise<string> {
    const { text } = await this.send({ method: 'GET', path, options })

    return text
  }

  async request<T>(request: InternalRequest): Promise<T> {
    const { status, text } = await this.send(request)

    if (text === '') {
      return undefined as T
    }

    try {
      return JSON.parse(text) as T
    } catch {
      throw new PostalError(status, 'invalid_response', "Postal's response is not valid JSON.")
    }
  }

  private url(path: string, query?: object): string {
    const url = new URL(this.baseUrl + path)

    for (const [key, value] of Object.entries(query ?? {}) as [string, QueryValue][]) {
      if (value === undefined || value === null) {
        continue
      }

      url.searchParams.set(key, Array.isArray(value) ? value.join(',') : String(value))
    }

    return url.toString()
  }

  private async send(request: InternalRequest): Promise<{ status: number; text: string }> {
    const idempotencyKey =
      request.options?.idempotencyKey ?? (request.autoIdempotency ? crypto.randomUUID() : undefined)
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
      Accept: 'application/json',
      'User-Agent': this.userAgent,
    }

    if (request.body !== undefined) {
      headers['Content-Type'] = 'application/json'
    }

    if (idempotencyKey !== undefined) {
      headers['Idempotency-Key'] = idempotencyKey
    }

    // Repeating a POST without an idempotency key after a 5xx or a network drop could duplicate the effect.
    const retriesServerErrors =
      request.method === 'GET' ||
      request.method === 'DELETE' ||
      request.idempotent === true ||
      idempotencyKey !== undefined
    const url = this.url(request.path, request.query)
    const body = request.body !== undefined ? JSON.stringify(request.body) : undefined

    for (let attempt = 0; ; attempt++) {
      const canRetry = attempt < this.maxRetries
      const outcome = await this.attempt(url, request.method, headers, body, request.options?.signal)

      if ('canceled' in outcome) {
        throw new PostalNetworkError('network_error', 'The request was canceled.', outcome.canceled)
      }

      if ('error' in outcome) {
        if (canRetry && retriesServerErrors) {
          await sleep(this.delay(attempt))
          continue
        }

        throw outcome.error
      }

      this.lastRateLimit = parseRateLimit(outcome.headers) ?? this.lastRateLimit

      if (outcome.status >= 200 && outcome.status < 300) {
        return outcome
      }

      const error = toError(outcome.status, outcome.statusText, outcome.headers, outcome.text)
      const retryable =
        (outcome.status === 429 && !NON_RETRYABLE_429.includes(error.name)) ||
        (retriesServerErrors && (outcome.status >= 500 || error.name === 'concurrent_idempotent_requests'))

      if (canRetry && retryable) {
        await sleep(error.retryAfter !== undefined ? Math.min(error.retryAfter * 1000, MAX_RETRY_DELAY_MS) : this.delay(attempt))
        continue
      }

      throw error
    }
  }

  /**
   * One attempt, with the timeout also covering the reading of the body.
   */
  private async attempt(
    url: string,
    method: string,
    headers: Record<string, string>,
    body: string | undefined,
    external: AbortSignal | undefined,
  ): Promise<
    | { status: number; statusText: string; headers: Headers; text: string }
    | { error: PostalNetworkError }
    | { canceled: unknown }
  > {
    const controller = new AbortController()
    let timedOut = false
    let connectTimedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      controller.abort()
    }, this.timeout)
    const stopWatching =
      this.watchesConnection && this.connectTimeout > 0
        ? watchConnection(url, method, this.connectTimeout, () => {
            connectTimedOut = true
            controller.abort()
          })
        : undefined
    const onAbort = (): void => controller.abort()

    external?.addEventListener('abort', onAbort, { once: true })

    if (external?.aborted) {
      controller.abort()
    }

    try {
      const response = await this.fetchImpl(url, {
        method,
        headers,
        ...(body !== undefined ? { body } : {}),
        signal: controller.signal,
      })
      const text = await response.text()

      return { status: response.status, statusText: response.statusText, headers: response.headers, text }
    } catch (cause) {
      if (external?.aborted) {
        return { canceled: cause }
      }

      if (connectTimedOut) {
        return {
          error: new PostalNetworkError(
            'connect_timeout',
            `Timed out connecting to Postal (connectTimeout of ${this.connectTimeout} ms).`,
            cause,
          ),
        }
      }

      return {
        error: timedOut
          ? new PostalNetworkError('timeout', `Postal did not answer within ${this.timeout} ms.`, cause)
          : new PostalNetworkError('network_error', `Could not reach Postal: ${describe(cause)}`, cause),
      }
    } finally {
      clearTimeout(timer)
      stopWatching?.()
      external?.removeEventListener('abort', onAbort)
    }
  }

  private delay(attempt: number): number {
    const base = this.retryDelay * 2 ** attempt

    return Math.min(base + Math.random() * base * 0.25, MAX_RETRY_DELAY_MS)
  }
}

/**
 * A 429 that retrying will not fix: the plan quota ran out.
 */
const NON_RETRYABLE_429 = ['daily_quota_exceeded', 'monthly_quota_exceeded', 'ai_credits_exhausted']

function toError(status: number, statusText: string, headers: Headers, text: string): PostalError {
  const retryAfterHeader = headers.get('retry-after')
  const retryAfter = retryAfterHeader !== null && /^\d+$/.test(retryAfterHeader) ? Number(retryAfterHeader) : undefined
  let body: PostalErrorBody | undefined

  try {
    const parsed: unknown = JSON.parse(text)

    if (parsed !== null && typeof parsed === 'object' && typeof (parsed as { name?: unknown }).name === 'string') {
      body = parsed as PostalErrorBody
    }
  } catch {
    // a body that is not JSON (proxy, error page): falls to the generic error below
  }

  return new PostalError(
    status,
    body?.name ?? (status >= 500 ? 'internal_server_error' : 'unexpected_error'),
    body?.message ?? (statusText || `Postal error ${status}.`),
    {
      ...(retryAfter !== undefined ? { retryAfter } : {}),
      ...(body !== undefined ? { body } : {}),
      rateLimit: parseRateLimit(headers),
    },
  )
}

function describe(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}
