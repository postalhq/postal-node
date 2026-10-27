import assert from 'node:assert/strict'
import { afterEach, describe, it, mock } from 'node:test'
import { readFileSync } from 'node:fs'
import { Postal, PostalError, PostalNetworkError, VERSION, isPostalError } from '../dist/index.js'
import { apiError, fakeServer, hangingServer } from './helpers.mjs'

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

  describe('prazo de conexão (connectTimeout)', () => {
    let hanging

    afterEach(async () => {
      await hanging?.close()
      hanging = undefined
    })

    it('uma conexão que não abre estoura em connect_timeout, antes do timeout total', async (t) => {
      hanging = await hangingServer()

      if (hanging === null) {
        return t.skip('o ambiente não deixa a conexão pendente')
      }

      const postal = new Postal('ps_x', { baseUrl: hanging.baseUrl, connectTimeout: 150, timeout: 20_000, maxRetries: 0 })
      const started = Date.now()

      await assert.rejects(
        postal.domains.list(),
        (error) =>
          error instanceof PostalNetworkError &&
          error.name === 'connect_timeout' &&
          error.statusCode === 0 &&
          /connectTimeout de 150 ms/.test(error.message),
      )
      assert.ok(Date.now() - started < 5_000)
    })

    it('a falha de conexão é repetida como erro de rede (3 tentativas) e depois lançada', async (t) => {
      hanging = await hangingServer()

      if (hanging === null) {
        return t.skip('o ambiente não deixa a conexão pendente')
      }

      const postal = new Postal('ps_x', { baseUrl: hanging.baseUrl, connectTimeout: 150, timeout: 20_000, retryDelay: 1 })
      const started = Date.now()

      await assert.rejects(postal.domains.list(), (error) => error.name === 'connect_timeout')

      const elapsed = Date.now() - started

      assert.ok(elapsed >= 3 * 150 - 30, `3 tentativas de ~150 ms (levou ${elapsed} ms)`)
      assert.ok(elapsed < 5_000)
    })

    it('POST sem chave de idempotência não é repetido após connect_timeout', async (t) => {
      hanging = await hangingServer()

      if (hanging === null) {
        return t.skip('o ambiente não deixa a conexão pendente')
      }

      const postal = new Postal('ps_x', { baseUrl: hanging.baseUrl, connectTimeout: 150, retryDelay: 1 })
      const started = Date.now()

      await assert.rejects(postal.contacts.create({ email: 'fulano@exemplo.com' }), (error) => error.name === 'connect_timeout')
      assert.ok(Date.now() - started < 450)
    })

    it('connectTimeout: 0 desliga o prazo e vale só o timeout total', async (t) => {
      hanging = await hangingServer()

      if (hanging === null) {
        return t.skip('o ambiente não deixa a conexão pendente')
      }

      const postal = new Postal('ps_x', { baseUrl: hanging.baseUrl, connectTimeout: 0, timeout: 300, maxRetries: 0 })

      await assert.rejects(postal.domains.list(), (error) => error.name === 'timeout')
    })

    it('o padrão é 5 s', async (t) => {
      hanging = await hangingServer()

      if (hanging === null) {
        return t.skip('o ambiente não deixa a conexão pendente')
      }

      mock.timers.enable({ apis: ['setTimeout'] })

      try {
        const postal = new Postal('ps_x', { baseUrl: hanging.baseUrl, maxRetries: 0 })
        let outcome

        const request = postal.domains.list().then(
          () => (outcome = 'ok'),
          (error) => (outcome = error.name),
        )

        mock.timers.tick(4_999)
        await new Promise((resolve) => setImmediate(resolve))
        assert.equal(outcome, undefined, 'ainda não estourou aos 4999 ms')

        mock.timers.tick(1)
        await request
        assert.equal(outcome, 'connect_timeout')
      } finally {
        mock.timers.reset()
      }
    })

    it('uma conexão que abre não é cortada pelo prazo, mesmo com resposta lenta', async () => {
      const postal = await clientWith(() => new Promise((resolve) => setTimeout(() => resolve({ body: { ok: true } }), 250)), {
        connectTimeout: 100,
        maxRetries: 0,
      })

      assert.deepEqual(await postal.domains.list(), { ok: true })
    })

    it('com fetch próprio o prazo de conexão não é aplicado', async () => {
      const postal = new Postal('ps_x', {
        connectTimeout: 1,
        fetch: async () => {
          await new Promise((resolve) => setTimeout(resolve, 50))

          return new Response('{}', { status: 200 })
        },
      })

      assert.deepEqual(await postal.domains.list(), {})
    })
  })

  describe('rateLimit', () => {
    it('é null antes da primeira requisição', async () => {
      const postal = await clientWith(() => ({ body: {} }))

      assert.equal(postal.rateLimit, null)
    })

    it('lê os cabeçalhos da última resposta, sem requisição extra', async () => {
      const postal = await clientWith((_, count) => ({
        body: { id: 'em_1' },
        headers: { 'x-ratelimit-limit': '10', 'x-ratelimit-remaining': String(10 - count) },
      }))

      await postal.emails.send({ from: 'a@b.com', to: 'c@d.com', subject: 's', text: 't' })
      assert.deepEqual(postal.rateLimit, { limit: 10, remaining: 9, retryAfter: null, resetAt: null })

      await postal.emails.send({ from: 'a@b.com', to: 'c@d.com', subject: 's', text: 't' })
      assert.equal(postal.rateLimit?.remaining, 8)
      assert.equal(server.requests.length, 2)
      assert.ok(server.requests.every((request) => request.url === '/emails'))
    })

    it('continua null quando a resposta não traz os cabeçalhos', async () => {
      const postal = await clientWith(() => ({ body: {} }))

      await postal.domains.list()
      assert.equal(postal.rateLimit, null)
    })

    it('uma resposta sem os cabeçalhos mantém o último valor conhecido', async () => {
      const postal = await clientWith((_, count) => ({
        body: {},
        headers: count === 1 ? { 'x-ratelimit-limit': '5', 'x-ratelimit-remaining': '4' } : {},
      }))

      await postal.domains.list()
      await postal.domains.list()
      assert.equal(postal.rateLimit?.remaining, 4)
    })

    it('na 429, o erro e o cliente trazem Retry-After e X-RateLimit-Reset', async () => {
      const headers = { 'x-ratelimit-limit': '2', 'x-ratelimit-remaining': '0', 'retry-after': '3', 'x-ratelimit-reset': '1790000000' }
      const postal = await clientWith(() => apiError(429, 'rate_limit_exceeded', 'Too many', headers), { maxRetries: 0 })
      const expected = { limit: 2, remaining: 0, retryAfter: 3, resetAt: 1790000000 }

      await assert.rejects(postal.domains.list(), (error) => {
        assert.deepEqual(error.rateLimit, expected)
        assert.equal(error.retryAfter, 3)

        return true
      })
      assert.deepEqual(postal.rateLimit, expected)
    })

    it('ignora valores que não são números inteiros', async () => {
      const postal = await clientWith(() => ({
        body: {},
        headers: { 'x-ratelimit-limit': 'abc', 'x-ratelimit-remaining': '7', 'retry-after': 'Wed, 21 Oct 2026 07:28:00 GMT' },
      }))

      await postal.domains.list()
      assert.deepEqual(postal.rateLimit, { limit: null, remaining: 7, retryAfter: null, resetAt: null })
    })
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
