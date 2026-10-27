import { canWatchConnection, watchConnection } from './connect-timeout.js'
import { PostalError, PostalNetworkError, type PostalErrorBody } from './errors.js'
import { parseRateLimit, type RateLimit } from './rate-limit.js'

export const DEFAULT_BASE_URL = 'https://api.postal.so'
export const VERSION = '0.1.0'

export type Fetch = (input: string, init?: RequestInit) => Promise<Response>

export interface ClientOptions {
  /** Chave de API (`ps_...`). Padrão: a variável de ambiente `POSTAL_API_KEY`. */
  apiKey?: string
  /** URL base da API. Padrão: `https://api.postal.so`. */
  baseUrl?: string
  /** Tentativas extras em 429 e 5xx. Padrão: 2. Use 0 para desligar. */
  maxRetries?: number
  /** Tempo máximo de cada tentativa, do início ao fim, em milissegundos. Padrão: 30000. */
  timeout?: number
  /**
   * Tempo máximo só para abrir a conexão (DNS, TCP e TLS), em milissegundos. Padrão: 5000; 0 desliga.
   * Só é aplicado com o `fetch` global do Node; com um `fetch` próprio vale apenas `timeout`.
   * Com a API fora do ar, uma chamada bloqueia cerca de `(maxRetries + 1) × connectTimeout` mais as esperas.
   */
  connectTimeout?: number
  /** Espera base entre tentativas, em milissegundos (dobra a cada tentativa). Padrão: 500. */
  retryDelay?: number
  /** Implementação de `fetch`. Padrão: o `fetch` global. */
  fetch?: Fetch
  /** Texto acrescentado ao `User-Agent`. */
  userAgent?: string
}

export interface RequestOptions {
  /** Chave de idempotência (1 a 256 caracteres) de `POST /emails`, `/emails/batch` e `/events`. */
  idempotencyKey?: string
  /** Cancela a requisição. */
  signal?: AbortSignal
}

export type QueryValue = string | number | boolean | null | undefined | readonly (string | number)[]

interface InternalRequest {
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'
  path: string
  query?: object
  body?: unknown
  options?: RequestOptions
  /** Marca POST/PATCH que podem ser repetidos sem efeito duplicado (upsert). */
  idempotent?: boolean
  /** Gera uma chave de idempotência para o envio, reaproveitada nas tentativas. */
  autoIdempotency?: boolean
}

const MAX_RETRY_DELAY_MS = 30_000

/**
 * Cliente HTTP mínimo: autenticação, JSON, erros tipados e retentativas.
 * Usado por todos os recursos; não faz parte da API pública.
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
        'Informe a chave de API: new Postal("ps_...") ou a variável de ambiente POSTAL_API_KEY.',
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

  /** O limite de requisições da última resposta que o trouxe (ver `Postal.rateLimit`). */
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
   * Devolve o corpo como texto (para `GET /emails/{id}/raw`).
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
      throw new PostalError(status, 'invalid_response', 'A resposta do Postal não é um JSON válido.')
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

    // Repetir um POST sem chave de idempotência após um 5xx ou uma queda de rede poderia duplicar o efeito.
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
        throw new PostalNetworkError('network_error', 'A requisição foi cancelada.', outcome.canceled)
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
   * Uma tentativa, com o tempo limite cobrindo também a leitura do corpo.
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
            `Tempo esgotado ao conectar ao Postal (connectTimeout de ${this.connectTimeout} ms).`,
            cause,
          ),
        }
      }

      return {
        error: timedOut
          ? new PostalNetworkError('timeout', `O Postal não respondeu em ${this.timeout} ms.`, cause)
          : new PostalNetworkError('network_error', `Não foi possível falar com o Postal: ${describe(cause)}`, cause),
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
 * 429 que repetir não adianta: a cota do plano acabou.
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
    // corpo que não é JSON (proxy, página de erro): cai no erro genérico abaixo
  }

  return new PostalError(
    status,
    body?.name ?? (status >= 500 ? 'internal_server_error' : 'unexpected_error'),
    body?.message ?? (statusText || `Erro ${status} do Postal.`),
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
