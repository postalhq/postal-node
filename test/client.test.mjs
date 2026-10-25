import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'node:test'
import { readFileSync } from 'node:fs'
import { Postal, PostalError, PostalNetworkError, VERSION, isPostalError } from '../dist/index.js'
import { apiError, fakeServer } from './helpers.mjs'

let server

afterEach(async () => {
  await server?.close()
  server = undefined
})

async function clientWith(handler, options = {}) {
  server = await fakeServer(handler)

  return new Postal('ps_test_key', { baseUrl: server.baseUrl, retryDelay: 1, ...options })
}

describe('Postal', () => {
  it('a versão do código é a do package.json', () => {
    const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))

    assert.equal(VERSION, manifest.version)
  })

  it('falha sem chave de API', () => {
    const saved = process.env.POSTAL_API_KEY

    delete process.env.POSTAL_API_KEY

    try {
      assert.throws(() => new Postal(), (error) => error.name === 'missing_api_key')
    } finally {
      if (saved !== undefined) {
        process.env.POSTAL_API_KEY = saved
      }
    }
  })

  it('usa POSTAL_API_KEY quando nenhuma chave é passada', async () => {
    server = await fakeServer(() => ({ body: { id: 'e1' } }))
    process.env.POSTAL_API_KEY = 'ps_from_env'

    try {
      await new Postal({ baseUrl: server.baseUrl }).emails.send({ from: 'a@b.com', to: 'c@d.com', subject: 's', text: 't' })
    } finally {
      delete process.env.POSTAL_API_KEY
    }

    assert.equal(server.requests[0].headers.authorization, 'Bearer ps_from_env')
  })

  it('envia e-mail com Bearer, JSON e chave de idempotência', async () => {
    const postal = await clientWith(() => ({ body: { id: 'em_1' } }))
    const result = await postal.emails.send(
      { from: 'Minha empresa <voce@seudominio.com.br>', to: ['fulano@exemplo.com'], subject: 'Olá', html: '<p>Oi</p>' },
      { idempotencyKey: 'order-1' },
    )
    const [request] = server.requests

    assert.deepEqual(result, { id: 'em_1' })
    assert.equal(request.method, 'POST')
    assert.equal(request.url, '/emails')
    assert.equal(request.headers.authorization, 'Bearer ps_test_key')
    assert.equal(request.headers['idempotency-key'], 'order-1')
    assert.match(request.headers['user-agent'], /^postal-so-node\//)
    assert.equal(request.body.subject, 'Olá')
  })

  it('gera uma chave de idempotência e a reaproveita nas retentativas', async () => {
    const postal = await clientWith((_, count) => (count === 1 ? apiError(500, 'internal_server_error', 'boom') : { body: { id: 'em_2' } }))
    const result = await postal.emails.send({ from: 'a@b.com', to: 'c@d.com', subject: 's', text: 't' })
    const keys = server.requests.map((r) => r.headers['idempotency-key'])

    assert.equal(result.id, 'em_2')
    assert.equal(server.requests.length, 2)
    assert.ok(keys[0] && keys[0] === keys[1])
  })

  it('converte Date em ISO 8601 em scheduled_at', async () => {
    const postal = await clientWith(() => ({ body: { id: 'em_3' } }))

    await postal.emails.send({ from: 'a@b.com', to: 'c@d.com', subject: 's', text: 't', scheduled_at: new Date('2026-10-26T12:00:00Z') })

    assert.equal(server.requests[0].body.scheduled_at, '2026-10-26T12:00:00.000Z')
  })

  it('lança PostalError com name, message e statusCode do Postal', async () => {
    const postal = await clientWith(() => apiError(422, 'validation_error', 'Missing `subject` field.'))

    await assert.rejects(
      postal.emails.send({ from: 'a@b.com', to: 'c@d.com', text: 't' }),
      (error) => {
        assert.ok(error instanceof PostalError)
        assert.ok(isPostalError(error))
        assert.equal(error.name, 'validation_error')
        assert.equal(error.code, 'validation_error')
        assert.equal(error.message, 'Missing `subject` field.')
        assert.equal(error.statusCode, 422)

        return true
      },
    )
    assert.equal(server.requests.length, 1, 'não repete 422')
  })

  it('repete em 429 respeitando Retry-After e para ao esgotar as tentativas', async () => {
    const postal = await clientWith(() => apiError(429, 'rate_limit_exceeded', 'Too many', { 'retry-after': '0' }), { maxRetries: 2 })

    await assert.rejects(postal.contacts.get('fulano@exemplo.com'), (error) => error.name === 'rate_limit_exceeded' && error.retryAfter === 0)
    assert.equal(server.requests.length, 3)
  })

  it('não repete 429 de cota esgotada', async () => {
    const postal = await clientWith(() => apiError(429, 'daily_quota_exceeded', 'Quota'))

    await assert.rejects(postal.emails.send({ from: 'a@b.com', to: 'c@d.com', subject: 's', text: 't' }), (error) => error.name === 'daily_quota_exceeded')
    assert.equal(server.requests.length, 1)
  })

  it('repete 5xx em GET e devolve o sucesso', async () => {
    const postal = await clientWith((_, count) => (count < 3 ? apiError(503, 'ai_unavailable', 'busy') : { body: { object: 'list', has_more: false, data: [] } }))
    const list = await postal.domains.list()

    assert.equal(list.data.length, 0)
    assert.equal(server.requests.length, 3)
  })

  it('não repete 5xx em POST sem chave de idempotência (contacts.create)', async () => {
    const postal = await clientWith(() => apiError(500, 'internal_server_error', 'boom'))

    await assert.rejects(postal.contacts.create({ email: 'fulano@exemplo.com' }), (error) => error.statusCode === 500)
    assert.equal(server.requests.length, 1)
  })

  it('maxRetries: 0 desliga as retentativas', async () => {
    const postal = await clientWith(() => apiError(429, 'rate_limit_exceeded', 'x'), { maxRetries: 0 })

    await assert.rejects(postal.domains.list())
    assert.equal(server.requests.length, 1)
  })

  it('erro de rede vira PostalNetworkError', async () => {
    const postal = new Postal('ps_x', { baseUrl: 'http://127.0.0.1:1', maxRetries: 0 })

    await assert.rejects(postal.domains.list(), (error) => error instanceof PostalNetworkError && error.name === 'network_error' && error.statusCode === 0)
  })

  it('estoura o tempo limite', async () => {
    const postal = await clientWith(() => new Promise(() => {}), { timeout: 50, maxRetries: 0 })

    await assert.rejects(postal.domains.list(), (error) => error.name === 'timeout')
  })

  it('resposta que não é JSON do Postal vira erro genérico', async () => {
    const postal = await clientWith(() => ({ status: 502, body: '<html>Bad gateway</html>' }), { maxRetries: 0 })

    await assert.rejects(postal.domains.list(), (error) => error.statusCode === 502 && error.name === 'internal_server_error')
  })

  describe('contatos', () => {
    it('upsert por external_id usa /contacts/batch e devolve o resultado do item', async () => {
      const postal = await clientWith(() => ({
        body: {
          object: 'contact_batch', status: 'completed', total: 1,
          counts: { created: 1, updated: 0, unchanged: 0, failed: 0 },
          results: [{ index: 0, status: 'created', id: 'c1', external_id: 'user_42', user_id: 'user_42', email: 'fulano@exemplo.com' }],
        },
      }))
      const result = await postal.contacts.upsert({ external_id: 'user_42', email: 'fulano@exemplo.com', properties: { plan: 'pro' } })

      assert.equal(result.status, 'created')
      assert.equal(result.id, 'c1')
      assert.equal(server.requests[0].url, '/contacts/batch')
      assert.deepEqual(server.requests[0].body, { contacts: [{ external_id: 'user_42', email: 'fulano@exemplo.com', properties: { plan: 'pro' } }] })
    })

    it('upsert com item falho lança validation_error com a mensagem do item', async () => {
      const postal = await clientWith(() => ({
        body: { object: 'contact_batch', status: 'completed', total: 1, results: [{ index: 0, status: 'failed', id: null, external_id: null, email: null, error: 'No contact has this external_id. Send its `email` to create it.' }] },
      }))

      await assert.rejects(postal.contacts.upsert({ external_id: 'nobody' }), (error) => error.name === 'validation_error' && /Send its `email`/.test(error.message))
    })

    it('codifica e-mail e external_id no caminho', async () => {
      const postal = await clientWith(() => ({ body: { object: 'contact', id: 'c1' } }))

      await postal.contacts.get('fulano+teste@exemplo.com')
      await postal.contacts.getByExternalId('user 42')
      await postal.contacts.delete('c1')

      assert.deepEqual(server.requests.map((r) => `${r.method} ${r.url}`), [
        'GET /contacts/fulano%2Bteste%40exemplo.com',
        'GET /contacts/external_id%3Auser%2042',
        'DELETE /contacts/c1',
      ])
    })

    it('update, topics e segmentos', async () => {
      const postal = await clientWith(() => ({ body: { id: 'c1' } }))

      await postal.contacts.update('c1', { first_name: 'Fulano' })
      await postal.contacts.updateTopics('c1', [{ id: 't1', subscription: 'opt_out' }])
      await postal.contacts.addToSegment('c1', 's1')
      await postal.contacts.removeFromSegment('c1', 's1')

      assert.deepEqual(server.requests.map((r) => `${r.method} ${r.url}`), [
        'PATCH /contacts/c1',
        'PATCH /contacts/c1/topics',
        'POST /contacts/c1/segments/s1',
        'DELETE /contacts/c1/segments/s1',
      ])
      assert.deepEqual(server.requests[1].body, { topics: [{ id: 't1', subscription: 'opt_out' }] })
    })
  })

  describe('listas', () => {
    it('manda filtros na query e junta listas com vírgula', async () => {
      const postal = await clientWith(() => ({ body: { object: 'list', has_more: false, data: [] } }))

      await postal.emails.list({ limit: 5, status: ['bounced', 'complained'], search: undefined })

      assert.equal(server.requests[0].url, '/emails?limit=5&status=bounced%2Ccomplained')
    })

    it('iterate segue o cursor after até has_more ser falso', async () => {
      const postal = await clientWith((request) => {
        const after = new URL(request.url, 'http://x').searchParams.get('after')

        return after === null
          ? { body: { object: 'list', has_more: true, data: [{ id: 'a' }, { id: 'b' }] } }
          : { body: { object: 'list', has_more: false, data: [{ id: 'c' }] } }
      })
      const ids = []

      for await (const contact of postal.contacts.iterate({ search: 'ana' })) {
        ids.push(contact.id)
      }

      assert.deepEqual(ids, ['a', 'b', 'c'])
      assert.equal(server.requests[0].url, '/contacts?search=ana&limit=100')
      assert.equal(server.requests[1].url, '/contacts?search=ana&limit=100&after=b')
    })
  })

  describe('eventos, domínios e demais recursos', () => {
    it('envia evento com contato e propriedades', async () => {
      const postal = await clientWith(() => ({ status: 201, body: { object: 'event', id: 'ev1', contact_id: 'c1' } }))
      const result = await postal.events.send({ name: 'signup', contact: 'fulano@exemplo.com', properties: { plan: 'free' } }, { idempotencyKey: 'signup-42' })

      assert.equal(result.id, 'ev1')
      assert.equal(server.requests[0].url, '/events')
      assert.equal(server.requests[0].headers['idempotency-key'], 'signup-42')
      assert.deepEqual(server.requests[0].body, { name: 'signup', contact: 'fulano@exemplo.com', properties: { plan: 'free' } })
    })

    it('domínios: list, get e verify', async () => {
      const postal = await clientWith(() => ({ body: { object: 'domain', id: 'd1' } }))

      await postal.domains.list({ status: 'verified' })
      await postal.domains.get('d1')
      await postal.domains.verify('d1')

      assert.deepEqual(server.requests.map((r) => `${r.method} ${r.url}`), ['GET /domains?status=verified', 'GET /domains/d1', 'POST /domains/d1/verify'])
    })

    it('e-mails: get, update, cancel, batch e raw', async () => {
      const postal = await clientWith((request) => (request.url.endsWith('/raw') ? { body: 'From: a@b.com' } : { body: { data: [{ id: 'x' }] } }))

      await postal.emails.get('e1')
      await postal.emails.update('e1', { scheduled_at: '2026-10-26T09:00:00-03:00' })
      await postal.emails.cancel('e1')
      await postal.emails.batch([{ from: 'a@b.com', to: 'c@d.com', subject: 's', text: 't' }])
      const raw = await postal.emails.raw('e1')

      assert.equal(raw, 'From: a@b.com')
      assert.deepEqual(server.requests.map((r) => `${r.method} ${r.url}`), ['GET /emails/e1', 'PATCH /emails/e1', 'POST /emails/e1/cancel', 'POST /emails/batch', 'GET /emails/e1/raw'])
      assert.ok(Array.isArray(server.requests[3].body), 'o lote é uma lista')
    })

    it('segmentos, tópicos e webhooks', async () => {
      const postal = await clientWith(() => ({ body: {} }))

      await postal.segments.create({ name: 'Clientes' })
      await postal.topics.create({ name: 'Novidades', default_subscription: 'opt_in' })
      await postal.webhooks.create({ endpoint: 'https://exemplo.com/hook', events: ['email.delivered'] })
      await postal.webhooks.rotateSecret('w1')

      assert.deepEqual(server.requests.map((r) => `${r.method} ${r.url}`), ['POST /segments', 'POST /topics', 'POST /webhooks', 'POST /webhooks/w1/signing-secret/rotate'])
    })

    it('usage()', async () => {
      const postal = await clientWith(() => ({ body: { object: 'usage' } }))

      assert.equal((await postal.usage()).object, 'usage')
      assert.equal(server.requests[0].url, '/usage')
    })
  })
})
