import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { describe, it } from 'node:test'
import { PostalWebhookVerificationError, verifyWebhook } from '../dist/index.js'

const SECRET = 'whsec_c2VncmVkby1kZS1leGVtcGxvLTEyMzQ1Ng=='
const BODY = '{"type":"email.delivered","created_at":"2026-10-24T13:02:14.120Z","data":{"email_id":"abc"}}'
const ID = 'msg_123'
const TIMESTAMP = 1761321600
// Calculada pelo backend (App\Services\Webhooks\WebhookSigner::sign) para o corpo acima.
const BACKEND_SIGNATURE = 'DwAjFL7bHXusfCFHdLLHtcXFwxa+x4E+CzWtO6oF8Tk='

function sign(secret, id, timestamp, body) {
  return createHmac('sha256', Buffer.from(secret.replace(/^whsec_/, ''), 'base64')).update(`${id}.${timestamp}.${body}`).digest('base64')
}

function headers(signature = `v1,${BACKEND_SIGNATURE}`, extra = {}) {
  return { 'webhook-id': ID, 'webhook-timestamp': String(TIMESTAMP), 'webhook-signature': signature, ...extra }
}

describe('verifyWebhook', () => {
  it('a assinatura de referência do backend bate com o esquema implementado', () => {
    assert.equal(sign(SECRET, ID, TIMESTAMP, BODY), BACKEND_SIGNATURE)
  })

  it('aceita uma entrega válida e devolve o evento', () => {
    const event = verifyWebhook(BODY, headers(), SECRET, { now: TIMESTAMP + 10 })

    assert.equal(event.type, 'email.delivered')
    assert.equal(event.data.email_id, 'abc')
  })

  it('aceita Buffer, cabeçalhos svix-* e Headers', () => {
    const svix = { 'svix-id': ID, 'svix-timestamp': String(TIMESTAMP), 'svix-signature': `v1,${BACKEND_SIGNATURE}` }

    assert.equal(verifyWebhook(Buffer.from(BODY), svix, SECRET, { now: TIMESTAMP }).type, 'email.delivered')
    assert.equal(verifyWebhook(BODY, new Headers(headers()), SECRET, { now: TIMESTAMP }).type, 'email.delivered')
    assert.equal(verifyWebhook(BODY, Object.entries(headers()), SECRET, { now: TIMESTAMP }).type, 'email.delivered')
  })

  it('ignora maiúsculas nos nomes e aceita cabeçalhos do Node com arrays', () => {
    const node = { 'Webhook-Id': ID, 'Webhook-Timestamp': String(TIMESTAMP), 'Webhook-Signature': [`v1,${BACKEND_SIGNATURE}`] }

    assert.equal(verifyWebhook(BODY, node, SECRET, { now: TIMESTAMP }).type, 'email.delivered')
  })

  it('aceita várias assinaturas (troca de segredo) se uma conferir', () => {
    const signature = `v1,${sign('whsec_b3V0cm8=', ID, TIMESTAMP, BODY)} v1,${BACKEND_SIGNATURE}`

    assert.equal(verifyWebhook(BODY, headers(signature), SECRET, { now: TIMESTAMP }).type, 'email.delivered')
  })

  it('recusa corpo alterado', () => {
    assert.throws(() => verifyWebhook(`${BODY} `, headers(), SECRET, { now: TIMESTAMP }), PostalWebhookVerificationError)
  })

  it('recusa segredo errado', () => {
    assert.throws(() => verifyWebhook(BODY, headers(), 'whsec_b3V0cm8=', { now: TIMESTAMP }), (error) => error.name === 'webhook_verification_failed')
  })

  it('recusa timestamp fora da tolerância, para os dois lados', () => {
    assert.throws(() => verifyWebhook(BODY, headers(), SECRET, { now: TIMESTAMP + 301 }), /tolerância/)
    assert.throws(() => verifyWebhook(BODY, headers(), SECRET, { now: TIMESTAMP - 301 }), /tolerância/)
    assert.doesNotThrow(() => verifyWebhook(BODY, headers(), SECRET, { now: TIMESTAMP + 300 }))
    assert.doesNotThrow(() => verifyWebhook(BODY, headers(), SECRET, { now: TIMESTAMP + 5000, toleranceSeconds: 10000 }))
  })

  it('recusa cabeçalhos ausentes, versão desconhecida e assinatura de tamanho errado', () => {
    assert.throws(() => verifyWebhook(BODY, {}, SECRET, { now: TIMESTAMP }), /Faltam/)
    assert.throws(() => verifyWebhook(BODY, headers(`v2,${BACKEND_SIGNATURE}`), SECRET, { now: TIMESTAMP }), PostalWebhookVerificationError)
    assert.throws(() => verifyWebhook(BODY, headers('v1,abc'), SECRET, { now: TIMESTAMP }), PostalWebhookVerificationError)
    assert.throws(() => verifyWebhook(BODY, headers(undefined, { 'webhook-timestamp': 'ontem' }), SECRET), /inválido/)
  })

  it('usa o relógio real por padrão', () => {
    const timestamp = Math.floor(Date.now() / 1000)
    const signature = `v1,${sign(SECRET, ID, timestamp, BODY)}`

    assert.equal(verifyWebhook(BODY, { 'webhook-id': ID, 'webhook-timestamp': String(timestamp), 'webhook-signature': signature }, SECRET).type, 'email.delivered')
  })
})
