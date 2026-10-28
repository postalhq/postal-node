import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { describe, it } from 'node:test'
import { PostalWebhookVerificationError, verifyWebhook } from '../dist/index.js'

const SECRET = 'whsec_c2VncmVkby1kZS1leGVtcGxvLTEyMzQ1Ng=='
const BODY = '{"type":"email.delivered","created_at":"2026-10-24T13:02:14.120Z","data":{"email_id":"abc"}}'
const ID = 'msg_123'
const TIMESTAMP = 1761321600
// Computed by the backend (App\Services\Webhooks\WebhookSigner::sign) for the body above.
const BACKEND_SIGNATURE = 'DwAjFL7bHXusfCFHdLLHtcXFwxa+x4E+CzWtO6oF8Tk='

function sign(secret, id, timestamp, body) {
  return createHmac('sha256', Buffer.from(secret.replace(/^whsec_/, ''), 'base64')).update(`${id}.${timestamp}.${body}`).digest('base64')
}

function headers(signature = `v1,${BACKEND_SIGNATURE}`, extra = {}) {
  return { 'webhook-id': ID, 'webhook-timestamp': String(TIMESTAMP), 'webhook-signature': signature, ...extra }
}

describe('verifyWebhook', () => {
  it('the backend\'s reference signature matches the implemented scheme', () => {
    assert.equal(sign(SECRET, ID, TIMESTAMP, BODY), BACKEND_SIGNATURE)
  })

  it('accepts a valid delivery and returns the event', () => {
    const event = verifyWebhook(BODY, headers(), SECRET, { now: TIMESTAMP + 10 })

    assert.equal(event.type, 'email.delivered')
    assert.equal(event.data.email_id, 'abc')
  })

  it('accepts a Buffer, svix-* headers and Headers', () => {
    const svix = { 'svix-id': ID, 'svix-timestamp': String(TIMESTAMP), 'svix-signature': `v1,${BACKEND_SIGNATURE}` }

    assert.equal(verifyWebhook(Buffer.from(BODY), svix, SECRET, { now: TIMESTAMP }).type, 'email.delivered')
    assert.equal(verifyWebhook(BODY, new Headers(headers()), SECRET, { now: TIMESTAMP }).type, 'email.delivered')
    assert.equal(verifyWebhook(BODY, Object.entries(headers()), SECRET, { now: TIMESTAMP }).type, 'email.delivered')
  })

  it('ignores letter case in names and accepts Node headers with arrays', () => {
    const node = { 'Webhook-Id': ID, 'Webhook-Timestamp': String(TIMESTAMP), 'Webhook-Signature': [`v1,${BACKEND_SIGNATURE}`] }

    assert.equal(verifyWebhook(BODY, node, SECRET, { now: TIMESTAMP }).type, 'email.delivered')
  })

  it('accepts several signatures (secret rotation) if one checks out', () => {
    const signature = `v1,${sign('whsec_b3V0cm8=', ID, TIMESTAMP, BODY)} v1,${BACKEND_SIGNATURE}`

    assert.equal(verifyWebhook(BODY, headers(signature), SECRET, { now: TIMESTAMP }).type, 'email.delivered')
  })

  it('refuses a tampered body', () => {
    assert.throws(() => verifyWebhook(`${BODY} `, headers(), SECRET, { now: TIMESTAMP }), PostalWebhookVerificationError)
  })

  it('refuses the wrong secret', () => {
    assert.throws(() => verifyWebhook(BODY, headers(), 'whsec_b3V0cm8=', { now: TIMESTAMP }), (error) => error.name === 'webhook_verification_failed')
  })

  it('refuses a timestamp outside the tolerance, in both directions', () => {
    assert.throws(() => verifyWebhook(BODY, headers(), SECRET, { now: TIMESTAMP + 301 }), /tolerance/)
    assert.throws(() => verifyWebhook(BODY, headers(), SECRET, { now: TIMESTAMP - 301 }), /tolerance/)
    assert.doesNotThrow(() => verifyWebhook(BODY, headers(), SECRET, { now: TIMESTAMP + 300 }))
    assert.doesNotThrow(() => verifyWebhook(BODY, headers(), SECRET, { now: TIMESTAMP + 5000, toleranceSeconds: 10000 }))
  })

  it('refuses missing headers, an unknown version and a signature of the wrong length', () => {
    assert.throws(() => verifyWebhook(BODY, {}, SECRET, { now: TIMESTAMP }), /missing/)
    assert.throws(() => verifyWebhook(BODY, headers(`v2,${BACKEND_SIGNATURE}`), SECRET, { now: TIMESTAMP }), PostalWebhookVerificationError)
    assert.throws(() => verifyWebhook(BODY, headers('v1,abc'), SECRET, { now: TIMESTAMP }), PostalWebhookVerificationError)
    assert.throws(() => verifyWebhook(BODY, headers(undefined, { 'webhook-timestamp': 'ontem' }), SECRET), /invalid/)
  })

  it('uses the real clock by default', () => {
    const timestamp = Math.floor(Date.now() / 1000)
    const signature = `v1,${sign(SECRET, ID, timestamp, BODY)}`

    assert.equal(verifyWebhook(BODY, { 'webhook-id': ID, 'webhook-timestamp': String(timestamp), 'webhook-signature': signature }, SECRET).type, 'email.delivered')
  })
})
