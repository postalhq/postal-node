import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import { run } from '../dist/cli/index.js'
import { apiError, fakeServer } from './helpers.mjs'

let server
let home

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'postal-cli-'))
})

afterEach(async () => {
  await server?.close()
  server = undefined
  await rm(home, { recursive: true, force: true })
})

/**
 * Roda o CLI em memória, com HOME temporário e a API falsa.
 */
async function cli(args, { env = {}, secret = '', handler } = {}) {
  if (handler) {
    await server?.close()
    server = await fakeServer(handler)
  }

  const out = []
  const err = []
  const code = await run(args, {
    env: { HOME: home, ...(server ? { POSTAL_API_URL: server.baseUrl } : {}), ...env },
    stdout: (text) => out.push(text),
    stderr: (text) => err.push(text),
    readSecret: async () => secret,
    retryDelay: 1,
    version: '9.9.9',
  })

  return { code, stdout: out.join(''), stderr: err.join('') }
}

describe('ajuda', () => {
  it('--help lista os comandos em português', async () => {
    const { code, stdout } = await cli(['--help'])

    assert.equal(code, 0)
    assert.match(stdout, /Uso: postal <comando>/)
    assert.match(stdout, /emails send/)
    assert.match(stdout, /POSTAL_API_KEY/)
  })

  it('ajuda de um comando traz opções e exemplos', async () => {
    const { code, stdout } = await cli(['emails', 'send', '--help'])

    assert.equal(code, 0)
    assert.match(stdout, /--from REMETENTE/)
    assert.match(stdout, /--template ID/)
    assert.match(stdout, /Exemplos:/)
  })

  it('--version', async () => {
    assert.equal((await cli(['--version'])).stdout, '9.9.9\n')
  })

  it('comando desconhecido sai com 2', async () => {
    const { code, stderr } = await cli(['foo'])

    assert.equal(code, 2)
    assert.match(stderr, /Comando desconhecido/)
  })

  it('opção desconhecida sai com 2 e explica', async () => {
    const { code, stderr } = await cli(['emails', 'send', '--nada'], { env: { POSTAL_API_KEY: 'ps_x' } })

    assert.equal(code, 2)
    assert.match(stderr, /Opção desconhecida: --nada/)
  })

  it('grupo sem subcomando mostra a ajuda do grupo', async () => {
    const { code, stdout } = await cli(['emails'])

    assert.equal(code, 2)
    assert.match(stdout, /emails send/)
    assert.match(stdout, /emails get/)
  })
})

describe('login, logout e whoami', () => {
  it('login grava a chave com modo 0600 depois de conferir com a API', async () => {
    const { code, stdout } = await cli(['login'], {
      secret: 'ps_chave_de_teste_123456',
      handler: () => ({ body: { object: 'usage' } }),
    })
    const file = join(home, '.config', 'postal', 'config.json')

    assert.equal(code, 0)
    assert.match(stdout, /salva em/)
    assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), { api_key: 'ps_chave_de_teste_123456' })
    assert.equal((await stat(file)).mode & 0o777, 0o600)
    assert.equal((await stat(join(home, '.config', 'postal'))).mode & 0o777, 0o700)
    assert.equal(server.requests[0].headers.authorization, 'Bearer ps_chave_de_teste_123456')
  })

  it('login recusa chave inválida e não grava nada', async () => {
    const { code, stderr } = await cli(['login'], {
      secret: 'ps_errada',
      handler: () => apiError(403, 'invalid_api_key', 'API key is invalid'),
    })

    assert.equal(code, 1)
    assert.match(stderr, /invalid_api_key/)
    await assert.rejects(stat(join(home, '.config', 'postal', 'config.json')))
  })

  it('login aceita chave só de envio', async () => {
    const { code, stdout } = await cli(['login'], {
      secret: 'ps_so_envio_123456',
      handler: () => apiError(401, 'restricted_api_key', 'restricted'),
    })

    assert.equal(code, 0)
    assert.match(stdout, /só de envio/)
  })

  it('login recusa texto que não parece uma chave', async () => {
    const { code, stderr } = await cli(['login'], { secret: 'abc' })

    assert.equal(code, 2)
    assert.match(stderr, /começa com "ps_"/)
  })

  it('POSTAL_API_KEY tem precedência sobre o arquivo', async () => {
    await cli(['login', '--no-verify'], { secret: 'ps_do_arquivo_123456' })
    await cli(['domains', 'list'], {
      env: { POSTAL_API_KEY: 'ps_da_variavel_123456' },
      handler: () => ({ body: { object: 'list', has_more: false, data: [] } }),
    })

    assert.equal(server.requests[0].headers.authorization, 'Bearer ps_da_variavel_123456')
  })

  it('usa a chave do arquivo quando não há variável', async () => {
    await cli(['login', '--no-verify'], { secret: 'ps_do_arquivo_123456' })
    await cli(['domains', 'list'], { handler: () => ({ body: { object: 'list', has_more: false, data: [] } }) })

    assert.equal(server.requests[0].headers.authorization, 'Bearer ps_do_arquivo_123456')
  })

  it('sem chave, explica como entrar', async () => {
    const { code, stderr } = await cli(['domains', 'list'])

    assert.equal(code, 1)
    assert.match(stderr, /postal login/)
  })

  it('logout apaga o arquivo', async () => {
    await cli(['login', '--no-verify'], { secret: 'ps_do_arquivo_123456' })

    assert.match((await cli(['logout'])).stdout, /apagada/)
    assert.match((await cli(['logout'])).stdout, /Não havia/)
  })

  it('whoami mostra plano e chave mascarada', async () => {
    const { code, stdout } = await cli(['whoami'], {
      env: { POSTAL_API_KEY: 'ps_4Fq9xLmT2vKp8sWd1Yc5' },
      handler: () => ({
        body: {
          object: 'usage',
          plan: { id: 'pro', name: 'Pro', marketing_id: 'free', marketing_name: 'Free' },
          emails: { daily: { used: 12, limit: 100 }, monthly: { used: 40, limit: null } },
          sending: { paused: false },
          rate_limit: { limit: 10 },
        },
      }),
    })

    assert.equal(code, 0)
    assert.match(stdout, /Plano: Pro \(marketing: Free\)/)
    assert.match(stdout, /Envios hoje: 12 de 100/)
    assert.match(stdout, /Envios no mês: 40 de sem limite/)
    assert.doesNotMatch(stdout, /4Fq9xLmT2vKp8sWd1Yc5/)
  })

  it('whoami com chave só de envio diz que ela é válida', async () => {
    const { code, stdout } = await cli(['whoami', '--json'], {
      env: { POSTAL_API_KEY: 'ps_so_envio_123456' },
      handler: () => apiError(401, 'restricted_api_key', 'restricted'),
    })

    assert.equal(code, 0)
    assert.equal(JSON.parse(stdout).permission, 'sending_access')
  })
})

describe('emails send', () => {
  const env = { POSTAL_API_KEY: 'ps_x_123456789' }

  it('envia HTML e imprime o ID', async () => {
    const { code, stdout } = await cli(
      ['emails', 'send', '--from', 'Minha empresa <voce@seudominio.com.br>', '--to', 'fulano@exemplo.com', '--subject', 'Olá', '--html', '<p>Oi</p>'],
      { env, handler: () => ({ body: { id: 'em_1' } }) },
    )

    assert.equal(code, 0)
    assert.equal(stdout, 'E-mail enviado: em_1\n')
    assert.deepEqual(server.requests[0].body, {
      to: ['fulano@exemplo.com'],
      from: 'Minha empresa <voce@seudominio.com.br>',
      subject: 'Olá',
      html: '<p>Oi</p>',
    })
  })

  it('lê --text de arquivo e separa destinatários por vírgula sem quebrar nomes', async () => {
    const file = join(home, 'mensagem.txt')

    await writeFile(file, 'Olá do arquivo')

    await cli(
      ['emails', 'send', '--from', 'voce@seudominio.com.br', '--to', 'a@exemplo.com, "Silva, Fulano" <b@exemplo.com>', '--to', 'c@exemplo.com', '--subject', 'S', '--text', `@${file}`],
      { env, handler: () => ({ body: { id: 'em_2' } }) },
    )

    assert.equal(server.requests[0].body.text, 'Olá do arquivo')
    assert.deepEqual(server.requests[0].body.to, ['a@exemplo.com', '"Silva, Fulano" <b@exemplo.com>', 'c@exemplo.com'])
  })

  it('envia com template e variáveis', async () => {
    await cli(
      ['emails', 'send', '--to', 'fulano@exemplo.com', '--template', 'boas-vindas', '--var', 'NOME=Fulano', '--vars', '{"PLANO":"pro"}', '--idempotency-key', 'welcome-1'],
      { env, handler: () => ({ body: { id: 'em_3' } }) },
    )

    assert.deepEqual(server.requests[0].body, { to: ['fulano@exemplo.com'], template: { id: 'boas-vindas', variables: { PLANO: 'pro', NOME: 'Fulano' } } })
    assert.equal(server.requests[0].headers['idempotency-key'], 'welcome-1')
  })

  it('valida as combinações de opções', async () => {
    assert.match((await cli(['emails', 'send', '--from', 'a@b.com', '--subject', 's', '--html', 'x'], { env })).stderr, /--to/)
    assert.match((await cli(['emails', 'send', '--to', 'a@b.com', '--from', 'a@b.com', '--subject', 's'], { env })).stderr, /--html, --text ou --template/)
    assert.match((await cli(['emails', 'send', '--to', 'a@b.com', '--html', 'x'], { env })).stderr, /--from e --subject/)
    assert.match((await cli(['emails', 'send', '--to', 'a@b.com', '--template', 't', '--html', 'x'], { env })).stderr, /não os dois/)
    assert.equal((await cli(['emails', 'send', '--to', 'a@b.com', '--template', 't', '--var', 'semigual'], { env })).code, 2)
  })

  it('erro da API sai com 1 e mostra name e message', async () => {
    const { code, stderr } = await cli(
      ['emails', 'send', '--from', 'a@b.com', '--to', 'c@d.com', '--subject', 's', '--text', 't'],
      { env, handler: () => apiError(403, 'validation_error', 'The sending domain is not verified.') },
    )

    assert.equal(code, 1)
    assert.match(stderr, /Erro \(validation_error, 403\): The sending domain is not verified\./)
  })

  it('--json imprime a resposta e o erro como JSON', async () => {
    const ok = await cli(['emails', 'send', '--from', 'a@b.com', '--to', 'c@d.com', '--subject', 's', '--text', 't', '--json'], { env, handler: () => ({ body: { id: 'em_9' } }) })
    const bad = await cli(['emails', 'send', '--from', 'a@b.com', '--to', 'c@d.com', '--subject', 's', '--text', 't', '--json'], { env, handler: () => apiError(422, 'validation_error', 'x') })

    assert.deepEqual(JSON.parse(ok.stdout), { id: 'em_9' })
    assert.deepEqual(JSON.parse(bad.stderr), { error: { statusCode: 422, name: 'validation_error', message: 'x' } })
    assert.equal(bad.code, 1)
  })
})

describe('events, contacts e domains', () => {
  const env = { POSTAL_API_KEY: 'ps_x_123456789' }

  it('events send', async () => {
    const { code, stdout } = await cli(
      ['events', 'send', '--email', 'fulano@exemplo.com', '--name', 'signup', '--props', '{"plan":"free"}', '--contact-props', '{"source":"site"}'],
      { env, handler: () => ({ status: 201, body: { object: 'event', id: 'ev_1', contact_id: 'c_1' } }) },
    )

    assert.equal(code, 0)
    assert.match(stdout, /Evento enviado: ev_1 \(contato c_1\)/)
    assert.deepEqual(server.requests[0].body, {
      name: 'signup',
      contact: { email: 'fulano@exemplo.com' },
      properties: { plan: 'free' },
      contact_properties: { source: 'site' },
    })
  })

  it('events send exige --name e JSON válido', async () => {
    assert.equal((await cli(['events', 'send', '--email', 'a@b.com'], { env })).code, 2)
    assert.match((await cli(['events', 'send', '--name', 'x', '--props', 'não é json'], { env })).stderr, /objeto JSON/)
  })

  it('contacts upsert', async () => {
    const { code, stdout } = await cli(
      ['contacts', 'upsert', '--external-id', 'user_42', '--email', 'fulano@exemplo.com', '--first-name', 'Fulano', '--props', '{"plan":"pro"}'],
      {
        env,
        handler: () => ({
          body: { object: 'contact_batch', status: 'completed', total: 1, results: [{ index: 0, status: 'updated', id: 'c_1', external_id: 'user_42', email: 'fulano@exemplo.com' }] },
        }),
      },
    )

    assert.equal(code, 0)
    assert.match(stdout, /Contato atualizado: fulano@exemplo.com \(c_1\)/)
    assert.deepEqual(server.requests[0].body.contacts[0], { email: 'fulano@exemplo.com', external_id: 'user_42', first_name: 'Fulano', properties: { plan: 'pro' } })
  })

  it('contacts upsert sem e-mail nem external_id é erro de uso', async () => {
    assert.equal((await cli(['contacts', 'upsert', '--first-name', 'X'], { env })).code, 2)
  })

  it('domains list imprime uma tabela e --json imprime a lista', async () => {
    const body = { object: 'list', has_more: false, data: [{ id: 'd1', name: 'seudominio.com.br', status: 'verified', region: 'sa-east-1' }] }
    const text = await cli(['domains', 'list'], { env, handler: () => ({ body }) })
    const json = await cli(['domains', 'list', '--json'], { env })

    assert.match(text.stdout, /DOMÍNIO\s+STATUS\s+REGIÃO\s+ID/)
    assert.match(text.stdout, /seudominio\.com\.br\s+verified\s+sa-east-1\s+d1/)
    assert.deepEqual(JSON.parse(json.stdout), body)
  })
})

describe('binário', () => {
  it('dist/cli.js roda com --help', () => {
    const result = spawnSync(process.execPath, [fileURLToPath(new URL('../dist/cli.js', import.meta.url)), '--help'], { encoding: 'utf8' })

    assert.equal(result.status, 0)
    assert.match(result.stdout, /Uso: postal/)
  })

  it('lê a chave da entrada padrão em "postal login --no-verify"', async () => {
    const result = spawnSync(process.execPath, [fileURLToPath(new URL('../dist/cli.js', import.meta.url)), 'login', '--no-verify'], {
      encoding: 'utf8',
      input: 'ps_pela_entrada_123456\n',
      env: { PATH: process.env.PATH, HOME: home },
    })

    assert.equal(result.status, 0, result.stderr)
    assert.deepEqual(JSON.parse(await readFile(join(home, '.config', 'postal', 'config.json'), 'utf8')), { api_key: 'ps_pela_entrada_123456' })
  })
})
