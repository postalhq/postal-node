import type { RateLimit } from './rate-limit.js'

/**
 * Corpo de erro da API do Postal: `{ statusCode, name, message }`.
 */
export interface PostalErrorBody {
  statusCode: number
  name: string
  message: string
  [key: string]: unknown
}

/**
 * Erro devolvido pela API do Postal (qualquer status fora de 2xx).
 *
 * `name` e `message` são os do Postal: `name` é o código estável em inglês
 * (`validation_error`, `rate_limit_exceeded`, `invalid_api_key`...) e deve ser
 * usado para tratar o erro no código; `message` é para pessoas e pode mudar.
 */
export class PostalError extends Error {
  /** Status HTTP da resposta (0 quando não houve resposta). */
  readonly statusCode: number
  /** Segundos pedidos pelo Postal em `Retry-After`, se vieram. */
  readonly retryAfter: number | undefined
  /** Campos extras do corpo do erro (por exemplo `errors`). */
  readonly body: PostalErrorBody | undefined
  /** O limite de requisições dos cabeçalhos da resposta (na 429, com `retryAfter`), se vieram. */
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

  /** Alias de `name`, para quem prefere `error.code`. */
  get code(): string {
    return this.name
  }

  toJSON(): { statusCode: number; name: string; message: string } {
    return { statusCode: this.statusCode, name: this.name, message: this.message }
  }
}

/**
 * Falha de rede ou tempo esgotado: a API não chegou a responder.
 * `statusCode` é 0 e `name` é `network_error`, `timeout` (a API aceitou a conexão mas não respondeu a
 * tempo) ou `connect_timeout` (não foi possível abrir a conexão a tempo).
 */
export class PostalNetworkError extends PostalError {
  override readonly cause: unknown

  constructor(name: 'network_error' | 'timeout' | 'connect_timeout', message: string, cause?: unknown) {
    super(0, name, message)
    this.cause = cause
  }
}

/**
 * A assinatura de um webhook não confere (`name`: `webhook_verification_failed`).
 */
export class PostalWebhookVerificationError extends PostalError {
  constructor(message: string) {
    super(400, 'webhook_verification_failed', message)
  }
}

/**
 * Diz se um valor é um erro do Postal, mesmo vindo de outra cópia do pacote.
 */
export function isPostalError(value: unknown): value is PostalError {
  return (
    value instanceof PostalError ||
    (value instanceof Error &&
      typeof (value as { statusCode?: unknown }).statusCode === 'number' &&
      'retryAfter' in value)
  )
}
