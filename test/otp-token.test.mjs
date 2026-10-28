import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'node:test'
import { Postal, otpTokenHeader } from '../dist/index.js'
import { fakeServer } from './helpers.mjs'

let server

afterEach(async () => {
  await server?.close()
  server = undefined
})

describe('otpTokenHeader', () => {
  it('builds the value from the draft\'s example', () => {
    assert.equal(otpTokenHeader('123456', 'https://example.com'), '"123456"; origin="https://example.com"')
  })

  it('escapes only the backslash and the double quote', () => {
    assert.equal(otpTokenHeader('a"b\\c d~', 'https://example.com:8443'), '"a\\"b\\\\c d~"; origin="https://example.com:8443"')
  })

  it('accepts http on localhost and 127.0.0.1 and hosts in punycode', () => {
    for (const origin of ['http://localhost', 'http://localhost:5173', 'http://127.0.0.1:8000', 'https://xn--exmple-cua.com', 'https://[::1]', 'https://10.0.0.1']) {
      assert.equal(otpTokenHeader('1', origin), `"1"; origin="${origin}"`)
    }
  })

  it('refuses a code the mail client would not accept', () => {
    for (const code of ['', '12\n34', '12\t34', '12é34', '12\x7f34']) {
      assert.throws(
        () => otpTokenHeader(code, 'https://example.com'),
        (error) => error.name === 'validation_error' && error.statusCode === 0 && /OTP-Token code/.test(error.message),
        JSON.stringify(code),
      )
    }

    assert.throws(() => otpTokenHeader(123456, 'https://example.com'), (error) => error.name === 'validation_error')
  })

  it('refuses origins that are not canonical or trustworthy', () => {
    const bad = [
      'https://example.com/login',
      'https://example.com/',
      'https://example.com?x=1',
      'https://user@example.com',
      'https://Example.com',
      'HTTPS://example.com',
      'https://example.com:443',
      'http://localhost:80',
      'https://example.com:0',
      'https://example.com:65536',
      'https://example.com:0443',
      'http://example.com',
      'http://192.168.0.10',
      'null',
      '',
      'example.com',
      'ftp://example.com',
      'https://exämple.com',
      'https://example.com.',
      'https://example..com',
      'https://-example.com',
      'https://my_app.example.com',
      'https://123',
      'https://127.1',
      'https://exam ple.com',
      'https://[0:0:0:0:0:0:0:1]',
    ]

    for (const origin of bad) {
      assert.throws(
        () => otpTokenHeader('123456', origin),
        (error) => error.name === 'validation_error' && error.statusCode === 0 && /OTP-Token origin/.test(error.message),
        origin,
      )
    }
  })

  it('suggests the canonical origin when the address has one', () => {
    assert.throws(() => otpTokenHeader('123456', 'https://Example.com/login?x=1'), /Use "https:\/\/example\.com"\./)
    assert.throws(() => otpTokenHeader('123456', 'https://example.com:443'), /Use "https:\/\/example\.com"\./)
    assert.throws(() => otpTokenHeader('123456', 'http://example.com'), (error) => !/Use "/.test(error.message))
  })
})

describe('OTP-Token in the body sent to the API', () => {
  const header = otpTokenHeader('123456', 'https://example.com')
  const longHeader = otpTokenHeader('Ab3'.repeat(40), 'https://painel.example.com:8443')

  async function client() {
    server = await fakeServer((request) => (request.url === '/emails/batch' ? { body: { data: [{ id: 'e1' }] } } : { body: { id: 'e1' } }))

    return new Postal('ps_test_key', { baseUrl: server.baseUrl, retryDelay: 1 })
  }

  const base = { from: 'voce@seudominio.com.br', to: 'fulano@exemplo.com', subject: 'Seu código', html: '<p>Seu código: 123456</p>' }

  it('the header goes through unchanged in emails.send', async () => {
    const postal = await client()

    await postal.emails.send({ ...base, headers: { 'OTP-Token': header } })
    await postal.emails.send({ ...base, headers: { 'OTP-Token': longHeader, 'X-Entity-Ref-ID': 'a' } })

    assert.equal(server.requests[0].body.headers['OTP-Token'], header)
    assert.equal(server.requests[1].body.headers['OTP-Token'], longHeader)
    assert.ok(server.requests[0].raw.includes(String.raw`"OTP-Token":"\"123456\"; origin=\"https://example.com\""`), server.requests[0].raw)
    assert.ok(!server.requests[0].raw.includes('=?'))
    assert.ok(!server.requests[0].raw.includes('\\u0022'))
  })

  it('the header goes through unchanged in emails.batch', async () => {
    const postal = await client()

    await postal.emails.batch([
      { ...base, headers: { 'OTP-Token': header } },
      { ...base, to: 'bia@exemplo.com', headers: { 'OTP-Token': longHeader } },
    ])

    assert.deepEqual(
      server.requests[0].body.map((email) => email.headers['OTP-Token']),
      [header, longHeader],
    )
  })

  it('the header goes through unchanged with scheduling and with a template', async () => {
    const postal = await client()

    await postal.emails.send({ ...base, headers: { 'OTP-Token': header }, scheduled_at: new Date('2030-10-26T12:00:00Z') })
    await postal.emails.send({ to: 'fulano@exemplo.com', template: { id: 'codigo', variables: { CODIGO: '123456' } }, headers: { 'OTP-Token': header } })

    assert.equal(server.requests[0].body.headers['OTP-Token'], header)
    assert.equal(server.requests[0].body.scheduled_at, '2030-10-26T12:00:00.000Z')
    assert.equal(server.requests[1].body.headers['OTP-Token'], header)
    assert.deepEqual(server.requests[1].body.template, { id: 'codigo', variables: { CODIGO: '123456' } })
  })

  it('the API refusing the header arrives as PostalError 422', async () => {
    server = await fakeServer(() => ({ status: 422, body: { statusCode: 422, name: 'validation_error', message: 'The `OTP-Token` header must look like ...' } }))
    const postal = new Postal('ps_test_key', { baseUrl: server.baseUrl, retryDelay: 1 })

    await assert.rejects(postal.emails.send({ ...base, headers: { 'OTP-Token': '"123456"' } }), (error) => error.statusCode === 422 && error.name === 'validation_error')
  })
})
