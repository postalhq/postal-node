# postal-so

[Português (pt-BR)](README.pt-BR.md) · English

Official [Postal](https://postal.so) SDK and CLI for Node.js: send emails, keep contacts, fire product events and verify webhooks, with no runtime dependencies.

- Node 18 or newer, ESM, with TypeScript types.
- Uses Node's `fetch`. No dependencies are installed with it.
- Typed errors, idempotency keys and automatic retries on 429 and 5xx.
- The `postal` CLI in the same package.

API documentation: <https://postal.so/en/docs>. Guide to this SDK: <https://postal.so/en/docs/sdks>.

## Installation

```bash
npm install postal-so
```

## First send

Create an API key under **API keys** in the dashboard (it starts with `ps_`), store it in an environment variable and verify the domain you send from.

```bash
export POSTAL_API_KEY=ps_xxx
```

```ts
import { Postal } from 'postal-so'

const postal = new Postal() // reads POSTAL_API_KEY; or new Postal('ps_xxx')

const { id } = await postal.emails.send({
  from: 'Acme Store <you@yourdomain.com>',
  to: 'jane@example.com',
  subject: 'Welcome!',
  html: '<p>We are glad to have you here.</p>',
  text: 'We are glad to have you here.',
})
```

Do not use the key in a browser or an app: call Postal from your server. For systems that only send emails and events, create a **sending-only** key.

Fields have the same names as the API (`reply_to`, `scheduled_at`, `external_id`...), so the documentation at <https://postal.so/en/docs/api> applies directly to the SDK. Call options (such as `idempotencyKey`) use camelCase.

### Client options

```ts
const postal = new Postal('ps_xxx', {
  baseUrl: 'https://api.postal.so', // default
  maxRetries: 2, // extra attempts on 429 and 5xx; 0 turns it off
  timeout: 30_000, // milliseconds per attempt, from start to finish
  connectTimeout: 5_000, // milliseconds just to open the connection; 0 turns it off
  retryDelay: 500, // base wait in ms, doubles on every attempt
})
```

### Timeouts and retries

| Option | Default | What it limits |
| --- | --- | --- |
| `timeout` | 30 000 ms | The whole attempt: connection, sending the body and reading the response. Keep it high if you send large attachments (up to 40 MB). |
| `connectTimeout` | 5 000 ms | Only opening the connection (DNS, TCP and TLS). If it runs out, it becomes a `PostalNetworkError` with `name` `connect_timeout`. `0` turns it off. |
| `maxRetries` | 2 | Extra attempts (3 in total). `0` turns it off. |

The worst case for a call to block is:

```
(maxRetries + 1) × time of each attempt + waits between attempts
```

The wait starts at 500 ms and doubles on every attempt, with up to 25% extra (with the defaults, about 1.9 s in total at most). On a 429, the wait is the `Retry-After` (up to 30 s per attempt). With the defaults:

- **API unreachable** (the connection does not open): `3 × 5 s + ~1.9 s`, about **17 s**. `connectTimeout` is what makes this hold; with `timeout` alone it would be ~92 s.
- **API accepts the connection but does not answer**: `3 × 30 s + ~1.9 s`, about **92 s**.

Recommendations:

- **Synchronous web request** (someone waiting for the page): `timeout: 10_000` and `maxRetries: 1`. With the API unreachable this blocks about 11 s (`2 × 5 s + ~0.6 s`; use `connectTimeout: 3_000` for ~7 s) and at most about 21 s if it hangs after connecting. If the request sends large attachments, keep `timeout` higher or send through a queue.
- **Queued job** (nobody waiting): keep the defaults. Or better, let the queue itself retry the job.

```ts
const postal = new Postal(process.env.POSTAL_API_KEY, { timeout: 10_000, maxRetries: 1 })
```

`connectTimeout` uses undici's "connection opened" notice (Node's global `fetch`, through `diagnostics_channel`), because `fetch` has no deadline just for the connection. It applies when the SDK uses Node's global `fetch` and it exposes undici (`process.versions.undici`, tested on Node 22). With your own `fetch` (the `fetch` option) or on a runtime without undici, it is not applied and only `timeout` counts.

## Emails

```ts
// With a published template: from, subject and reply_to come from the template
await postal.emails.send({
  to: 'jane@example.com',
  template: { id: 'welcome', variables: { NAME: 'Jane' } },
})

// Scheduled (up to 30 days), with an attachment and a tag
const { id } = await postal.emails.send({
  from: 'you@yourdomain.com',
  to: ['jane@example.com'],
  subject: 'Your invoice',
  html: '<p>Attached.</p>',
  attachments: [{ filename: 'invoice.pdf', content: pdfInBase64 }],
  tags: [{ name: 'category', value: 'billing' }],
  scheduled_at: new Date(Date.now() + 3600_000),
})

await postal.emails.update(id, { scheduled_at: '2026-10-26T09:00:00-03:00' }) // reschedules
await postal.emails.cancel(id) // cancels

// Up to 100 emails in one request: either all are queued, or none
await postal.emails.batch([
  { from: 'you@yourdomain.com', to: 'ann@example.com', subject: 'Your coupon', html: '<p>WELCOME</p>' },
  { from: 'you@yourdomain.com', to: 'bea@example.com', subject: 'Your coupon', html: '<p>WELCOME</p>' },
])

const email = await postal.emails.get(id) // status in email.last_event and history in email.events
const page = await postal.emails.list({ status: ['bounced', 'complained'], limit: 50 })
```

`emails.list` and the other read methods need a full-access key. Two reads also work with a sending-only key: `emails.get` (only the emails it sent) and `usage()` (without the verification credits).

### One-time codes (`OTP-Token`)

The `OTP-Token` header ([draft-goto-otp-token](https://datatracker.ietf.org/doc/draft-goto-otp-token/)) delivers the code of a verification email in a machine-readable way, bound to an origin, so that the mail client offers it to the page that asked for it. The SDK sends `headers` as they are (without encoding the quotes, in `send`, `batch`, scheduled sends and with a template); `otpTokenHeader(code, origin)` builds the value with the right escaping:

```ts
import { Postal, otpTokenHeader } from 'postal-so'

await postal.emails.send({
  from: 'you@yourdomain.com',
  to: 'jane@example.com',
  subject: 'Your verification code',
  html: '<p>Your code: <b>123456</b></p>',
  headers: { 'OTP-Token': otpTokenHeader('123456', 'https://example.com') }, // "123456"; origin="https://example.com"
})
```

The code must be printable ASCII; the origin, the canonical one of whoever asks for the code (`https://host[:port]` in lowercase, no path, no trailing slash and no default port; `http` only on `localhost`). If it will not do, `otpTokenHeader` throws `PostalError` (`name: 'validation_error'`, `statusCode: 0`) before the API refuses the send with 422. Pass the header only once.

### Idempotency

To repeat a send without emailing twice, pass a key that identifies the *reason* for the send (not the attempt):

```ts
await postal.emails.send(params, { idempotencyKey: 'order-10482-shipped' })
```

Without a key, the SDK generates one (a UUID) for each call of `emails.send`, `emails.batch` and `events.send` and reuses it on retries, so a timeout, a connection failure or a 5xx does not duplicate the send. The other `POST` and `PATCH` calls (such as `contacts.create`, `segments.create` and `emails.cancel`) carry no key: the SDK only repeats them on 429 (the API refused before processing), never after a 5xx or a network failure, because repeating could duplicate the effect. `contacts.upsert` and `contacts.batch` are safe to repeat and are therefore repeated. See [Idempotency](https://postal.so/en/docs/idempotencia).

## Contacts

`external_id` is the person's ID in your system. `upsert` creates or updates the contact looking it up by `id`, then `external_id`, then `email`, and repeating the call is safe.

```ts
const result = await postal.contacts.upsert({
  external_id: 'user_42',
  email: 'jane@example.com', // required to create a new contact
  first_name: 'Jane',
  properties: { plan: 'pro' }, // the property must exist beforehand
})
console.log(result.status) // 'created' | 'updated' | 'unchanged'

const contact = await postal.contacts.getByExternalId('user_42')
await postal.contacts.update('jane@example.com', { unsubscribed: true })
await postal.contacts.delete(contact.id)

for await (const c of postal.contacts.iterate({ search: 'ann' })) {
  console.log(c.email) // walks through all the pages
}
```

Someone who unsubscribed only receives again if you send `resubscribe: { consented_at, proof }` with proof of the new consent. `contacts.batch([...])` does the same for many contacts at once.

## Events

Events tell Postal what happens in your product and start the automations with that trigger. They work with a sending-only key.

```ts
await postal.events.send({
  name: 'signup',
  contact: 'jane@example.com', // a new email creates the contact
  properties: { plan: 'free', source: 'site' },
})

await postal.events.send(
  {
    name: 'order.paid',
    contact: 'external_id:user_42',
    properties: { total: 199.9, currency: 'USD' },
    contact_properties: { plan: 'pro' }, // updates the contact before the automations
  },
  { idempotencyKey: 'order-10482-paid' },
)
```

## Segments, topics and domains

```ts
const { id: segmentId } = await postal.segments.create({ name: 'Active customers' })
await postal.contacts.addToSegment('jane@example.com', segmentId)

await postal.topics.create({ name: 'News', default_subscription: 'opt_in', visibility: 'public' })

const domains = await postal.domains.list()
await postal.domains.verify(domains.data[0].id) // checks DNS now
const domain = await postal.domains.get(domains.data[0].id) // records and the status of each
```

## Webhooks

Register the endpoint in the dashboard or with `postal.webhooks.create({ endpoint, events })` and keep the `signing_secret` (`whsec_...`). `verifyWebhook(payload, headers, secret)` checks the signature (Standard Webhooks: HMAC-SHA256 of `{webhook-id}.{webhook-timestamp}.{body}`), refuses messages more than 5 minutes off and returns the event. Use the **raw** body, exactly as it arrived.

```ts
import express from 'express'
import { verifyWebhook, PostalWebhookVerificationError } from 'postal-so'

const app = express()

app.post('/webhooks/postal', express.raw({ type: 'application/json' }), (req, res) => {
  try {
    const event = verifyWebhook(req.body, req.headers, process.env.POSTAL_WEBHOOK_SECRET!)

    if (event.type === 'email.bounced') {
      // drop the address
    }

    res.sendStatus(200)
  } catch (error) {
    if (error instanceof PostalWebhookVerificationError) {
      return res.sendStatus(400)
    }
    throw error
  }
})
```

In `Request`-style routes (Next.js, Hono...):

```ts
export async function POST(request: Request) {
  const body = await request.text() // raw, before any JSON.parse
  const event = verifyWebhook(body, request.headers, process.env.POSTAL_WEBHOOK_SECRET!)
  return new Response('ok')
}
```

Use the `webhook-id` header to discard repeated deliveries. See [Webhooks](https://postal.so/en/docs/webhooks).

## Errors

Every error response from Postal becomes a `PostalError` with the `statusCode`, the `name` (a stable code in English, such as `validation_error`) and Postal's `message`. Handle it by `name`, not by message.

```ts
import { PostalError } from 'postal-so'

try {
  await postal.emails.send(params)
} catch (error) {
  if (error instanceof PostalError) {
    console.error(error.statusCode, error.name, error.message)

    if (error.name === 'daily_quota_exceeded') {
      // the daily quota ran out; it comes back at 00:00 UTC
    }
  }
  throw error
}
```

Network failures and timeouts become `PostalNetworkError` (`statusCode` 0; `name` `network_error`, `timeout` or `connect_timeout`). The codes are at <https://postal.so/en/docs/erros>.

### Retries

- `429 rate_limit_exceeded` is always repeated, waiting for the `Retry-After`. An exhausted quota (`daily_quota_exceeded`, `monthly_quota_exceeded`) is not repeated.
- `5xx`, `409 concurrent_idempotent_requests` and network failures are repeated on `GET`, `DELETE`, on sends with an idempotency key (the automatic one included) and on `contacts.upsert`. On a `POST` without a key, such as `contacts.create`, they are not: repeating could duplicate the effect.
- The wait starts at 500 ms and doubles on every attempt (30 s at most).
- A connection failure or timeout (`connect_timeout`) counts as a network failure and follows the same rule.

### Rate limit

`postal.rateLimit` keeps the requests-per-second limit read from the headers of the last response (`X-RateLimit-Limit`, `X-RateLimit-Remaining` and, on a 429, `Retry-After` and `X-RateLimit-Reset`). Unlike `postal.usage()`, it works with a **sending-only** key and makes no extra request.

```ts
await postal.emails.send(params)

const rateLimit = postal.rateLimit // null until a response with the headers arrives
// { limit: 10, remaining: 9, retryAfter: null, resetAt: null }

if (rateLimit !== null && rateLimit.remaining === 0) {
  // slow down the bulk send
}
```

The fields are `limit` and `remaining` (requests per second), and `retryAfter` (seconds) and `resetAt` (Unix timestamp in seconds), which only come on a 429. Whatever did not come is `null`. Error responses count too: the `PostalError` of a 429 carries the same object in `error.rateLimit`. A response without the headers keeps the last known value.

## CLI

The package installs the `postal` command:

```bash
npx postal-so --help   # or: npm install -g postal-so
postal login           # asks for the key and stores it in ~/.config/postal/config.json (mode 0600)
postal whoami
```

`POSTAL_API_KEY` takes precedence over the stored key. In CI, use only the variable.

```bash
postal emails send --from "Acme Store <you@yourdomain.com>" \
  --to jane@example.com --subject "Hello" --html "<p>Welcome!</p>"

postal emails send --to jane@example.com --template welcome --var NAME=Jane

postal events send --email jane@example.com --name signup --props '{"plan":"free"}'

postal contacts upsert --external-id user_42 --email jane@example.com --props '{"plan":"pro"}'

postal domains list
```

Add `--json` for machine output (the error also comes out as JSON, on stderr). Exit codes: `0` worked, `1` API or network error, `2` incorrect usage. `postal <command> --help` shows the options, in Portuguese.

## Skill for AI agents

The package ships a skill (`skills/postal/SKILL.md`, also in Portuguese as `SKILL.pt-BR.md`) that teaches Claude Code, Codex and Cursor to integrate Postal into your app. Copy the `skills/postal` folder to `.claude/skills/` (or to your tool's skills folder).

## Development

```bash
npm install
npm test   # compiles and runs node --test with a local fake HTTP server
```

## License

MIT
