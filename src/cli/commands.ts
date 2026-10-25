import { Postal } from '../client.js'
import { PostalError } from '../errors.js'
import type { Json, SendEmailParams } from '../types.js'
import {
  flagOption,
  listOption,
  parseJsonObject,
  parsePairs,
  splitAddresses,
  stringOption,
  textOrFile,
  UsageError,
  type OptionSpecs,
  type ParsedValues,
} from './args.js'
import { configPath, maskKey, removeConfig, writeConfig, type KeySource } from './config.js'
import type { CliContext } from './context.js'

export interface Command {
  /** Palavras do comando, como `['emails', 'send']`. */
  path: string[]
  summary: string
  /** Texto longo da ajuda (opcional). */
  details?: string
  options: OptionSpecs
  examples: string[]
  /** Exige chave de API? Padrão: sim. */
  needsKey?: boolean
  run(request: CommandRequest): Promise<CommandResult>
}

export interface CommandRequest {
  context: CliContext
  values: ParsedValues
  positionals: string[]
  /** Cliente já autenticado (ausente em `login` e `logout`). */
  postal: Postal
  keySource: KeySource | undefined
  apiKey: string | undefined
}

export interface CommandResult {
  /** O que `--json` imprime. */
  json: unknown
  /** O que sai no modo normal. */
  text: string
}

const idempotencyOption = {
  'idempotency-key': {
    type: 'string',
    value: 'CHAVE',
    description: 'Chave de idempotência: repetir com a mesma chave não duplica o envio.',
  },
} as const satisfies OptionSpecs

const login: Command = {
  path: ['login'],
  summary: 'Guarda a chave de API neste computador',
  details:
    'Pede a chave (a digitação não aparece na tela) e a grava em ~/.config/postal/config.json com permissão 0600.\n' +
    'Também lê a chave da entrada padrão: echo "$CHAVE" | postal login.\n' +
    'A variável de ambiente POSTAL_API_KEY tem precedência sobre o arquivo.',
  options: {
    'no-verify': { type: 'boolean', description: 'Grava a chave sem conferir com a API.' },
  },
  examples: ['postal login', 'echo "$POSTAL_API_KEY" | postal login'],
  needsKey: false,
  async run({ context, values }) {
    const typed = (await context.readSecret('Chave de API (ps_...): ')).trim()

    if (typed === '') {
      throw new UsageError('Nenhuma chave informada.')
    }

    if (!typed.startsWith('ps_')) {
      throw new UsageError('A chave de API do Postal começa com "ps_". Confira em Chaves de API, no painel.')
    }

    let note = ''

    if (!flagOption(values, 'no-verify')) {
      try {
        await clientFor(context, typed).usage()
      } catch (error) {
        const restricted = error instanceof PostalError && error.name === 'restricted_api_key'
        const unreachable = error instanceof PostalError && error.statusCode === 0

        if (restricted) {
          note = ' (chave só de envio)'
        } else if (unreachable) {
          note = ' (não consegui conferir a chave: sem conexão com a API)'
        } else {
          throw error
        }
      }
    }

    const path = await writeConfig(context.env, { api_key: typed })

    return {
      json: { saved: true, path },
      text: `Chave ${maskKey(typed)} salva em ${path}${note}.`,
    }
  },
}

const logout: Command = {
  path: ['logout'],
  summary: 'Apaga a chave guardada neste computador',
  options: {},
  examples: ['postal logout'],
  needsKey: false,
  async run({ context }) {
    const removed = await removeConfig(context.env)

    return {
      json: { removed },
      text: removed ? `Chave apagada de ${configPath(context.env)}.` : 'Não havia chave guardada.',
    }
  },
}

const whoami: Command = {
  path: ['whoami'],
  summary: 'Mostra a conta e a chave em uso',
  options: {},
  examples: ['postal whoami', 'postal whoami --json'],
  async run({ postal, keySource, apiKey, context }) {
    const source = keySource === 'env' ? 'variável POSTAL_API_KEY' : configPath(context.env)
    const key = maskKey(apiKey ?? '')

    try {
      const usage = await postal.usage()
      const lines = [
        `Plano: ${usage.plan.name}${usage.plan.marketing_name ? ` (marketing: ${usage.plan.marketing_name})` : ''}`,
        `Chave: ${key} (acesso total, de ${source})`,
        `Envios hoje: ${usage.emails.daily.used} de ${usage.emails.daily.limit ?? 'sem limite'}`,
        `Envios no mês: ${usage.emails.monthly.used} de ${usage.emails.monthly.limit ?? 'sem limite'}`,
        `Requisições: ${usage.rate_limit.limit} por segundo`,
        `Envio: ${usage.sending.paused ? `pausado${usage.sending.reason ? ` (${usage.sending.reason})` : ''}` : 'ativo'}`,
      ]

      return {
        json: { authenticated: true, permission: 'full_access', key: key, key_source: keySource, usage },
        text: lines.join('\n'),
      }
    } catch (error) {
      if (error instanceof PostalError && error.name === 'restricted_api_key') {
        return {
          json: { authenticated: true, permission: 'sending_access', key, key_source: keySource },
          text: `Chave: ${key} (só de envio, de ${source}). Ela é válida, mas não lê dados da conta.`,
        }
      }

      throw error
    }
  },
}

const emailsSend: Command = {
  path: ['emails', 'send'],
  summary: 'Envia um e-mail',
  details:
    'Os valores de --html e --text aceitam @arquivo para ler o conteúdo de um arquivo.\n' +
    'Para vários destinatários, repita --to ou separe por vírgula.',
  options: {
    from: { type: 'string', value: 'REMETENTE', description: 'Remetente: voce@seudominio.com.br ou "Nome <voce@seudominio.com.br>".' },
    to: { type: 'string', multiple: true, value: 'EMAIL', description: 'Destinatário (até 50).' },
    subject: { type: 'string', value: 'ASSUNTO', description: 'Assunto.' },
    html: { type: 'string', value: 'HTML', description: 'Corpo em HTML (ou @arquivo.html).' },
    text: { type: 'string', value: 'TEXTO', description: 'Corpo em texto puro (ou @arquivo.txt).' },
    template: { type: 'string', value: 'ID', description: 'ID ou alias de um template publicado, no lugar de --html/--text.' },
    var: { type: 'string', multiple: true, value: 'NOME=valor', description: 'Variável do template (repita para várias).' },
    vars: { type: 'string', value: 'JSON', description: 'Variáveis do template em JSON.' },
    cc: { type: 'string', multiple: true, value: 'EMAIL', description: 'Cópia.' },
    bcc: { type: 'string', multiple: true, value: 'EMAIL', description: 'Cópia oculta.' },
    'reply-to': { type: 'string', multiple: true, value: 'EMAIL', description: 'Endereço para resposta.' },
    tag: { type: 'string', multiple: true, value: 'nome=valor', description: 'Etiqueta do envio (repita para várias).' },
    'scheduled-at': { type: 'string', value: 'DATA', description: 'Agenda o envio (ISO 8601, até 30 dias).' },
    ...idempotencyOption,
  },
  examples: [
    'postal emails send --from "Minha empresa <voce@seudominio.com.br>" --to fulano@exemplo.com --subject "Olá" --html "<p>Bem-vindo!</p>"',
    'postal emails send --from voce@seudominio.com.br --to fulano@exemplo.com --subject "Olá" --text @mensagem.txt',
    'postal emails send --to fulano@exemplo.com --template boas-vindas --var NOME=Fulano',
  ],
  async run({ postal, values }) {
    const to = splitAddresses(listOption(values, 'to'))
    const template = stringOption(values, 'template')
    const html = await textOrFile(stringOption(values, 'html'), 'html')
    const text = await textOrFile(stringOption(values, 'text'), 'text')
    const from = stringOption(values, 'from')
    const subject = stringOption(values, 'subject')

    if (to.length === 0) {
      throw new UsageError('Informe o destinatário com --to.')
    }

    if (template !== undefined && (html !== undefined || text !== undefined)) {
      throw new UsageError('Use --template ou --html/--text, não os dois.')
    }

    if (template === undefined && html === undefined && text === undefined) {
      throw new UsageError('Informe o conteúdo com --html, --text ou --template.')
    }

    if (template === undefined && (from === undefined || subject === undefined)) {
      throw new UsageError('Sem template, informe --from e --subject.')
    }

    const variables = {
      ...(parseJsonObject(stringOption(values, 'vars'), 'vars') as Record<string, string> | undefined),
      ...parsePairs(listOption(values, 'var'), 'var'),
    }
    const tags = Object.entries(parsePairs(listOption(values, 'tag'), 'tag')).map(([name, value]) => ({ name, value }))
    const cc = splitAddresses(listOption(values, 'cc'))
    const bcc = splitAddresses(listOption(values, 'bcc'))
    const replyTo = splitAddresses(listOption(values, 'reply-to'))
    const scheduledAt = stringOption(values, 'scheduled-at')
    const common = {
      to,
      ...(from !== undefined ? { from } : {}),
      ...(subject !== undefined ? { subject } : {}),
      ...(cc.length > 0 ? { cc } : {}),
      ...(bcc.length > 0 ? { bcc } : {}),
      ...(replyTo.length > 0 ? { reply_to: replyTo } : {}),
      ...(tags.length > 0 ? { tags } : {}),
      ...(scheduledAt !== undefined ? { scheduled_at: scheduledAt } : {}),
    }
    const params = (
      template !== undefined
        ? { ...common, template: { id: template, ...(Object.keys(variables).length > 0 ? { variables } : {}) } }
        : { ...common, ...(html !== undefined ? { html } : {}), ...(text !== undefined ? { text } : {}) }
    ) as SendEmailParams
    const key = stringOption(values, 'idempotency-key')
    const result = await postal.emails.send(params, key !== undefined ? { idempotencyKey: key } : undefined)

    return {
      json: result,
      text: `${scheduledAt !== undefined ? 'E-mail agendado' : 'E-mail enviado'}: ${result.id}`,
    }
  },
}

const emailsGet: Command = {
  path: ['emails', 'get'],
  summary: 'Mostra o status de um e-mail',
  options: {},
  examples: ['postal emails get 019a1b2c-4d5e-7f60-8a9b-0c1d2e3f4a5b'],
  async run({ postal, positionals }) {
    const id = positionals[0]

    if (id === undefined) {
      throw new UsageError('Informe o ID do e-mail: postal emails get <id>.')
    }

    const email = await postal.emails.get(id)

    return {
      json: email,
      text: [
        `ID: ${email.id}`,
        `Status: ${email.last_event}`,
        `De: ${email.from}`,
        `Para: ${email.to.join(', ')}`,
        `Assunto: ${email.subject}`,
        `Criado em: ${email.created_at}`,
      ].join('\n'),
    }
  },
}

const eventsSend: Command = {
  path: ['events', 'send'],
  summary: 'Envia um evento para iniciar automações',
  details: 'Um e-mail que ainda não está na audiência cria o contato. Funciona com chave só de envio.',
  options: {
    name: { type: 'string', value: 'NOME', description: 'Nome do evento, como signup ou order.paid.' },
    email: { type: 'string', value: 'EMAIL', description: 'E-mail do contato.' },
    'external-id': { type: 'string', value: 'ID', description: 'ID da pessoa no seu sistema.' },
    props: { type: 'string', value: 'JSON', description: 'Propriedades do evento em JSON.' },
    'contact-props': { type: 'string', value: 'JSON', description: 'Propriedades do contato a atualizar, em JSON.' },
    'occurred-at': { type: 'string', value: 'DATA', description: 'Quando aconteceu (ISO 8601). Padrão: agora.' },
    ...idempotencyOption,
  },
  examples: [
    `postal events send --email fulano@exemplo.com --name signup --props '{"plan":"free"}'`,
    `postal events send --external-id user_42 --name order.paid --props '{"total":99.9}' --idempotency-key order-42-paid`,
  ],
  async run({ postal, values }) {
    const name = stringOption(values, 'name')
    const email = stringOption(values, 'email')
    const externalId = stringOption(values, 'external-id')

    if (name === undefined) {
      throw new UsageError('Informe o nome do evento com --name.')
    }

    const properties = parseJsonObject(stringOption(values, 'props'), 'props')
    const contactProperties = parseJsonObject(stringOption(values, 'contact-props'), 'contact-props')
    const occurredAt = stringOption(values, 'occurred-at')
    const key = stringOption(values, 'idempotency-key')
    const result = await postal.events.send(
      {
        name,
        ...(email !== undefined || externalId !== undefined
          ? { contact: { ...(email !== undefined ? { email } : {}), ...(externalId !== undefined ? { external_id: externalId } : {}) } }
          : {}),
        ...(properties !== undefined ? { properties: properties as Record<string, Json> } : {}),
        ...(contactProperties !== undefined ? { contact_properties: contactProperties as Record<string, Json> } : {}),
        ...(occurredAt !== undefined ? { occurred_at: occurredAt } : {}),
      },
      key !== undefined ? { idempotencyKey: key } : undefined,
    )

    return {
      json: result,
      text: `Evento enviado: ${result.id}${result.contact_id ? ` (contato ${result.contact_id})` : ' (sem contato: não inicia automações)'}`,
    }
  },
}

const contactsUpsert: Command = {
  path: ['contacts', 'upsert'],
  summary: 'Cria ou atualiza um contato',
  details: 'Procura o contato por --external-id e, se não achar, por --email. Para criar um contato novo, informe --email.',
  options: {
    email: { type: 'string', value: 'EMAIL', description: 'E-mail do contato.' },
    'external-id': { type: 'string', value: 'ID', description: 'ID da pessoa no seu sistema.' },
    'first-name': { type: 'string', value: 'NOME', description: 'Nome.' },
    'last-name': { type: 'string', value: 'SOBRENOME', description: 'Sobrenome.' },
    props: { type: 'string', value: 'JSON', description: 'Propriedades de contato em JSON.' },
    segment: { type: 'string', multiple: true, value: 'ID', description: 'ID de um segmento estático a que o contato entra.' },
    unsubscribed: { type: 'boolean', description: 'Marca o contato como descadastrado.' },
  },
  examples: [
    `postal contacts upsert --external-id user_42 --email fulano@exemplo.com --first-name Fulano --props '{"plan":"pro"}'`,
  ],
  async run({ postal, values }) {
    const email = stringOption(values, 'email')
    const externalId = stringOption(values, 'external-id')

    if (email === undefined && externalId === undefined) {
      throw new UsageError('Informe --email ou --external-id.')
    }

    const properties = parseJsonObject(stringOption(values, 'props'), 'props')
    const segments = listOption(values, 'segment')
    const firstName = stringOption(values, 'first-name')
    const lastName = stringOption(values, 'last-name')
    const result = await postal.contacts.upsert({
      ...(email !== undefined ? { email } : {}),
      ...(externalId !== undefined ? { external_id: externalId } : {}),
      ...(firstName !== undefined ? { first_name: firstName } : {}),
      ...(lastName !== undefined ? { last_name: lastName } : {}),
      ...(properties !== undefined ? { properties: properties as Record<string, Json> } : {}),
      ...(segments.length > 0 ? { segments } : {}),
      ...(flagOption(values, 'unsubscribed') ? { unsubscribed: true } : {}),
    })
    const outcome = { created: 'criado', updated: 'atualizado', unchanged: 'sem alterações' }[result.status]

    return {
      json: result,
      text: `Contato ${outcome}: ${result.email} (${result.id})${result.warnings?.length ? `\nAviso: ${result.warnings.join(', ')}` : ''}`,
    }
  },
}

const contactsGet: Command = {
  path: ['contacts', 'get'],
  summary: 'Mostra um contato pelo e-mail, ID ou external_id:<id>',
  options: {},
  examples: ['postal contacts get fulano@exemplo.com', 'postal contacts get external_id:user_42'],
  async run({ postal, positionals }) {
    const reference = positionals[0]

    if (reference === undefined) {
      throw new UsageError('Informe o e-mail, o ID ou external_id:<id>: postal contacts get <contato>.')
    }

    const contact = await postal.contacts.get(reference)

    return {
      json: contact,
      text: [
        `E-mail: ${contact.email}`,
        `ID: ${contact.id}`,
        `external_id: ${contact.external_id ?? '-'}`,
        `Nome: ${[contact.first_name, contact.last_name].filter(Boolean).join(' ') || '-'}`,
        `Descadastrado: ${contact.unsubscribed ? 'sim' : 'não'}`,
        `Propriedades: ${JSON.stringify(contact.properties)}`,
      ].join('\n'),
    }
  },
}

const domainsList: Command = {
  path: ['domains', 'list'],
  summary: 'Lista os domínios e o status da verificação',
  options: {
    status: { type: 'string', value: 'STATUS', description: 'Filtra por status (verified, pending, failed...).' },
    limit: { type: 'string', value: 'N', description: 'Quantidade de domínios (1 a 100).' },
  },
  examples: ['postal domains list', 'postal domains list --status verified --json'],
  async run({ postal, values }) {
    const limit = stringOption(values, 'limit')

    if (limit !== undefined && !/^\d+$/.test(limit)) {
      throw new UsageError('--limit precisa ser um número.')
    }

    const status = stringOption(values, 'status')
    const list = await postal.domains.list({
      ...(limit !== undefined ? { limit: Number(limit) } : {}),
      ...(status !== undefined ? { status: status as 'verified' } : {}),
    })

    if (list.data.length === 0) {
      return { json: list, text: 'Nenhum domínio cadastrado. Cadastre um em https://postal.so/docs/dominios-e-dns' }
    }

    const rows = [['DOMÍNIO', 'STATUS', 'REGIÃO', 'ID'], ...list.data.map((d) => [d.name, d.status, d.region, d.id])]

    return { json: list, text: table(rows) + (list.has_more ? '\n(há mais domínios: use --limit)' : '') }
  },
}

const domainsVerify: Command = {
  path: ['domains', 'verify'],
  summary: 'Pede a verificação do DNS de um domínio',
  options: {},
  examples: ['postal domains verify 0199f0e1-2a3b-7c4d-8e5f-6a7b8c9d0e1f'],
  async run({ postal, positionals }) {
    const id = positionals[0]

    if (id === undefined) {
      throw new UsageError('Informe o ID do domínio: postal domains verify <id>.')
    }

    const result = await postal.domains.verify(id)

    return { json: result, text: `Verificação iniciada para ${result.id}. Veja o resultado com: postal domains list` }
  },
}

export const commands: Command[] = [
  login,
  logout,
  whoami,
  emailsSend,
  emailsGet,
  eventsSend,
  contactsUpsert,
  contactsGet,
  domainsList,
  domainsVerify,
]

export function clientFor(context: CliContext, apiKey: string): Postal {
  return new Postal({
    apiKey,
    ...(context.env['POSTAL_API_URL'] ? { baseUrl: context.env['POSTAL_API_URL'] } : {}),
    ...(context.fetch ? { fetch: context.fetch } : {}),
    ...(context.retryDelay !== undefined ? { retryDelay: context.retryDelay } : {}),
    userAgent: 'cli',
  })
}

function table(rows: string[][]): string {
  const widths = rows[0]!.map((_, column) => Math.max(...rows.map((row) => (row[column] ?? '').length)))

  return rows.map((row) => row.map((cell, column) => cell.padEnd(widths[column] ?? 0)).join('  ').trimEnd()).join('\n')
}
