---
name: postal
description: Integrates Postal (postal.so) into an app: installs the SDK, stores the API key in an environment variable, sends transactional emails, sends sign-up and payment events, syncs contacts with external_id and verifies webhooks. Use when the request mentions Postal, transactional email, welcome emails, receipts, password resets or product events for email automations.
---

[Português (pt-BR)](SKILL.pt-BR.md) · English

# Postal: integrating it into an app

Postal is an email platform (transactional and marketing). The API lives at `https://api.postal.so`, authenticated with `Authorization: Bearer ps_...`. Full documentation: <https://postal.so/en/docs>. Page list for agents: <https://postal.so/llms.en.txt>.

## Before writing code

1. Check which language the project uses. Node/TypeScript: package `postal-so`. PHP/Laravel: `postal-so/postal-php`. Others: call the API over HTTP.
2. The sender's domain must be **verified** in Postal (<https://postal.so/en/docs/dominios-e-dns>). Without that, sending fails with `403 validation_error`. If the user does not have a domain yet, say so instead of inventing a sender.
3. Ask (or look in `.env.example`) where the project's environment variables live.

## 1. Install the SDK

```bash
npm install postal-so          # Node 18+, ESM, no dependencies
composer require postal-so/postal-php   # PHP 8.2+
```

## 2. API key

- Create it under **API keys** in the dashboard. It starts with `ps_` and is shown only once.
- Store it in `POSTAL_API_KEY` (`.env`, the deploy's secrets vault). **Never** in code, in the repository, in the browser or in a mobile app: call Postal only from the server.
- For a system that only sends emails and events, use a **sending-only** key (`sending_access`), which can be restricted to one domain. It covers `POST /emails`, `POST /emails/batch` and `POST /events`, and reads `GET /emails/{id}` (only what it sent) and `GET /usage`; the rest of the API needs full access.
- Add `POSTAL_API_KEY=` to `.env.example`, with no value.

## 3. Send an email

```ts
import { Postal } from 'postal-so'

const postal = new Postal() // reads POSTAL_API_KEY

await postal.emails.send(
  {
    from: 'Acme Store <you@yourdomain.com>',
    to: 'jane@example.com',
    subject: 'Password reset',
    html: '<p>Use the link below to create a new password.</p>',
    text: 'Use the link to create a new password.',
  },
  { idempotencyKey: `password-reset-${resetId}` },
)
```

- `to` is a string or a list of up to 50. Always send `text` along with `html`.
- For emails the product fires many times (receipt, welcome), pass `idempotencyKey` with the *reason* for the send (`order-10482-receipt`), never a new value on every attempt.
- With a published template: `template: { id: 'welcome', variables: { NAME: 'Jane' } }` in place of `html`/`text`.
- For an email with a verification code typed into a page: add `headers: { 'OTP-Token': otpTokenHeader('123456', 'https://your-app.com') }` (`import { otpTokenHeader } from 'postal-so'`) so the mail client fills in the code by itself; the origin is that of the site asking for the code, in lowercase and with no path.
- Send in the background (queue/job) when the email does not need to block the response to the user.

## 4. Sign-up and payment events

Events start automations (welcome series, payment recovery...) and work with a sending-only key. Send them when the fact happens, from the server:

```ts
// Sign-up
await postal.events.send(
  { name: 'signup', contact: user.email, properties: { plan: 'free', source: 'site' } },
  { idempotencyKey: `signup-${user.id}` },
)

// Payment succeeded
await postal.events.send(
  {
    name: 'payment.succeeded',
    contact: `external_id:${user.id}`,
    properties: { amount: 199.9, currency: 'USD', plan: 'pro' },
    contact_properties: { plan: 'pro' },
  },
  { idempotencyKey: `payment-${payment.id}` },
)
```

- `name`: letters, numbers, `.`, `_`, `:` and `-`, up to 100 characters. Use stable names in English (`signup`, `payment.succeeded`, `payment.failed`, `trial.started`).
- `contact` accepts an email, a contact ID, `external_id:<id>` or an object `{ email, external_id, first_name }`. A new email creates the contact.
- `properties` (up to 16 KB) are available in automations and emails. `contact_properties` updates the contact before the automations; the property must exist beforehand (create it in the dashboard or in `/contact-properties`).
- Events without `contact` are recorded, but do not start automations.

## 5. Contacts with `external_id`

`external_id` is the user's ID in the customer's system. `upsert` on sign-up and whenever the data changes:

```ts
await postal.contacts.upsert({
  external_id: String(user.id),
  email: user.email,        // required to create
  first_name: user.name,
  properties: { plan: user.plan },
})
```

`upsert` looks up by `id`, then `external_id`, then `email`, and repeating it is safe. To stop sending marketing, use `unsubscribed: true`, do not delete the contact. Someone who unsubscribed is only resubscribed with `resubscribe: { consented_at, proof }`; never resubscribe without consent.

## 6. Webhooks

Register the URL (public HTTPS) in the dashboard or with `postal.webhooks.create({ endpoint, events })` and keep the `signing_secret` (`whsec_...`) in `POSTAL_WEBHOOK_SECRET`.

```ts
import { verifyWebhook } from 'postal-so'

// RAW body, before any JSON.parse
const event = verifyWebhook(rawBody, request.headers, process.env.POSTAL_WEBHOOK_SECRET!)

switch (event.type) {
  case 'email.bounced':
  case 'email.complained':
    // stop sending to event.data.to
    break
}
```

- In Express use `express.raw({ type: 'application/json' })`; in `Request` routes use `await request.text()`. If the framework already parsed the JSON, the signature will not match.
- Answer `2xx` quickly and process in a queue. Discard duplicates by the `webhook-id` header.
- In PHP: `Postal\Webhook::verify($payload, $headers, $secret)`.
- Event types: `email.sent`, `email.delivered`, `email.bounced`, `email.complained`, `email.opened`, `email.clicked`, `email.failed`, `contact.created`, `contact.updated`, `domain.updated`, among others: <https://postal.so/en/docs/webhooks>.

## 7. Errors and limits

- Errors arrive as `PostalError` with `statusCode`, `name` (a stable code, such as `validation_error`) and `message`. Handle them by `name`.
- `429 rate_limit_exceeded`: the SDK already retries, respecting `Retry-After`. `daily_quota_exceeded` and `monthly_quota_exceeded` are not solved by retrying.
- In a synchronous web request, use `timeout: 10_000` and `maxRetries: 1`; `connectTimeout` (default 5 s) already limits the blocking when the API is unreachable. `postal.rateLimit` shows the requests limit of the last response, even with a sending-only key.
- Do not retry without fixing the cause on 400, 401, 403, 404 and 422.
- Codes: <https://postal.so/en/docs/erros>.

## What not to do

- Do not put the key in browser code, a mobile app or a repository.
- Do not use real people's addresses in tests: use `jane@example.com`.
- Do not send marketing to anyone who has not consented; use events and automations for lifecycle email, and topics/segments for campaigns.
- Do not generate a random `idempotencyKey` on every attempt: that defeats the protection.

## Check the integration

```bash
npx postal-so login                # stores the key (or use POSTAL_API_KEY)
npx postal-so whoami
npx postal-so emails send --from "Acme Store <you@yourdomain.com>" --to jane@example.com --subject "Test" --text "It worked"
npx postal-so events send --email jane@example.com --name signup --props '{"plan":"free"}'
```

## Links

- Quickstart: <https://postal.so/en/docs/primeiros-passos>
- Authentication: <https://postal.so/en/docs/autenticacao>
- Sending emails: <https://postal.so/en/docs/api/emails>
- Events: <https://postal.so/en/docs/api/eventos>
- Contacts: <https://postal.so/en/docs/api/contatos>
- Webhooks: <https://postal.so/en/docs/webhooks>
- Idempotency: <https://postal.so/en/docs/idempotencia>
- SDKs: <https://postal.so/en/docs/sdks> · CLI: <https://postal.so/en/docs/cli>
