import { createHmac, timingSafeEqual } from 'node:crypto'
import { PostalWebhookVerificationError } from './errors.js'
import type { Json, WebhookEvent } from './types.js'

export type WebhookHeaders =
  | Headers
  | Record<string, string | readonly string[] | undefined>
  | Iterable<readonly [string, string]>

export interface VerifyWebhookOptions {
  /** Maximum difference accepted between the `webhook-timestamp` and now, in seconds. Default: 300. */
  toleranceSeconds?: number
  /** Clock, in Unix seconds. For tests only. */
  now?: number
}

/**
 * Verifies the signature of a Postal webhook delivery (Standard Webhooks) and returns the event.
 *
 * The signature is `base64(HMAC-SHA256(key, "{webhook-id}.{webhook-timestamp}.{body}"))`, sent in the
 * `webhook-signature` header as `v1,<base64>` (the same values come in `svix-id`, `svix-timestamp`
 * and `svix-signature`). The key is the `signing_secret` (`whsec_...`) without the prefix, Base64-decoded.
 *
 * Pass the **raw** body, exactly as it arrived: if the framework already parsed the JSON, the signature
 * will not match. Throws `PostalWebhookVerificationError` if anything does not check out.
 *
 * @param payload Raw body of the request.
 * @param headers Request headers (a Node object, `Headers` or a list of pairs).
 * @param secret The webhook's `signing_secret`, as `whsec_...`.
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
      'The webhook-id, webhook-timestamp or webhook-signature headers are missing.',
    )
  }

  if (!/^\d+$/.test(timestamp)) {
    throw new PostalWebhookVerificationError('The webhook-timestamp is invalid.')
  }

  const tolerance = options.toleranceSeconds ?? 300
  const now = options.now ?? Math.floor(Date.now() / 1000)

  if (Math.abs(now - Number(timestamp)) > tolerance) {
    throw new PostalWebhookVerificationError('The webhook-timestamp is outside the tolerance (old or repeated message).')
  }

  if (!secret) {
    throw new PostalWebhookVerificationError('Provide the webhook signing_secret (whsec_...).')
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
    throw new PostalWebhookVerificationError('The webhook signature does not match.')
  }

  try {
    return JSON.parse(body) as WebhookEvent<T>
  } catch {
    throw new PostalWebhookVerificationError('The webhook body is not valid JSON.')
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
