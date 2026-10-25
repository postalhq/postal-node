import { createHmac, timingSafeEqual } from 'node:crypto'
import { PostalWebhookVerificationError } from './errors.js'
import type { Json, WebhookEvent } from './types.js'

export type WebhookHeaders =
  | Headers
  | Record<string, string | readonly string[] | undefined>
  | Iterable<readonly [string, string]>

export interface VerifyWebhookOptions {
  /** Diferença máxima aceita entre o `webhook-timestamp` e agora, em segundos. Padrão: 300. */
  toleranceSeconds?: number
  /** Relógio, em segundos Unix. Só para testes. */
  now?: number
}

/**
 * Confere a assinatura de uma entrega de webhook do Postal (Standard Webhooks) e devolve o evento.
 *
 * A assinatura é `base64(HMAC-SHA256(chave, "{webhook-id}.{webhook-timestamp}.{corpo}"))`, enviada no
 * cabeçalho `webhook-signature` como `v1,<base64>` (os mesmos valores vêm em `svix-id`, `svix-timestamp`
 * e `svix-signature`). A chave é o `signing_secret` (`whsec_...`) sem o prefixo, decodificado de Base64.
 *
 * Passe o corpo **cru**, exatamente como chegou: se o framework já fez o parse do JSON, a assinatura
 * não vai bater. Lança `PostalWebhookVerificationError` se algo não conferir.
 *
 * @param payload Corpo cru da requisição.
 * @param headers Cabeçalhos da requisição (objeto do Node, `Headers` ou lista de pares).
 * @param secret `signing_secret` do webhook, como `whsec_...`.
 *
 * @example
 * app.post('/webhooks/postal', express.raw({ type: 'application/json' }), (req, res) => {
 *   const event = verifyWebhook(req.body, req.headers, process.env.POSTAL_WEBHOOK_SECRET!)
 *   res.sendStatus(200)
 * })
 */
export function verifyWebhook<T = Record<string, Json>>(
  payload: string | Uint8Array,
  headers: WebhookHeaders,
  secret: string,
  options: VerifyWebhookOptions = {},
): WebhookEvent<T> {
  const body = typeof payload === 'string' ? payload : Buffer.from(payload).toString('utf8')
  const lookup = normalizeHeaders(headers)
  const id = lookup('webhook-id') ?? lookup('svix-id')
  const timestamp = lookup('webhook-timestamp') ?? lookup('svix-timestamp')
  const signatures = lookup('webhook-signature') ?? lookup('svix-signature')

  if (!id || !timestamp || !signatures) {
    throw new PostalWebhookVerificationError(
      'Faltam os cabeçalhos webhook-id, webhook-timestamp ou webhook-signature.',
    )
  }

  if (!/^\d+$/.test(timestamp)) {
    throw new PostalWebhookVerificationError('O webhook-timestamp é inválido.')
  }

  const tolerance = options.toleranceSeconds ?? 300
  const now = options.now ?? Math.floor(Date.now() / 1000)

  if (Math.abs(now - Number(timestamp)) > tolerance) {
    throw new PostalWebhookVerificationError('O webhook-timestamp está fora da tolerância (mensagem antiga ou repetida).')
  }

  if (!secret) {
    throw new PostalWebhookVerificationError('Informe o signing_secret do webhook (whsec_...).')
  }

  const key = Buffer.from(secret.replace(/^whsec_/, ''), 'base64')
  const expected = createHmac('sha256', key).update(`${id}.${timestamp}.${body}`).digest()
  const matches = signatures
    .split(' ')
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '')
    .some((entry) => {
      const separator = entry.indexOf(',')

      if (separator === -1 || entry.slice(0, separator) !== 'v1') {
        return false
      }

      const received = Buffer.from(entry.slice(separator + 1), 'base64')

      return received.length === expected.length && timingSafeEqual(received, expected)
    })

  if (!matches) {
    throw new PostalWebhookVerificationError('A assinatura do webhook não confere.')
  }

  try {
    return JSON.parse(body) as WebhookEvent<T>
  } catch {
    throw new PostalWebhookVerificationError('O corpo do webhook não é um JSON válido.')
  }
}

function normalizeHeaders(headers: WebhookHeaders): (name: string) => string | undefined {
  const map = new Map<string, string>()

  if (typeof Headers !== 'undefined' && headers instanceof Headers) {
    headers.forEach((value, name) => map.set(name.toLowerCase(), value))
  } else if (Symbol.iterator in Object(headers)) {
    for (const [name, value] of headers as Iterable<readonly [string, string]>) {
      map.set(name.toLowerCase(), value)
    }
  } else {
    for (const [name, value] of Object.entries(headers as Record<string, string | readonly string[] | undefined>)) {
      if (value !== undefined) {
        map.set(name.toLowerCase(), typeof value === 'string' ? value : value.join(' '))
      }
    }
  }

  return (name) => map.get(name)
}
