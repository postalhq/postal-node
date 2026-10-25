import { PostalError } from '../errors.js'
import { parseOptions, UsageError, type OptionSpecs } from './args.js'
import { clientFor, commands, type Command } from './commands.js'
import { resolveApiKey } from './config.js'
import type { CliContext } from './context.js'

export type { CliContext } from './context.js'

const GLOBAL_OPTIONS: OptionSpecs = {
  json: { type: 'boolean', description: 'Imprime o resultado em JSON (saída de máquina).' },
  help: { type: 'boolean', short: 'h', description: 'Mostra esta ajuda.' },
}

/**
 * Executa o CLI e devolve o código de saída: 0 deu certo, 1 erro da API ou de rede, 2 uso incorreto.
 */
export async function run(argv: string[], context: CliContext): Promise<number> {
  const [first] = argv

  if (first === undefined || first === 'help' || first === '--help' || first === '-h') {
    context.stdout(rootHelp(argv[1] ? [argv[1]] : []))

    return 0
  }

  if (first === '--version' || first === '-v' || first === 'version') {
    context.stdout(`${context.version}\n`)

    return 0
  }

  const { command, rest } = findCommand(argv)
  const json = argv.includes('--json')

  try {
    if (command === undefined) {
      const group = commands.some((c) => c.path[0] === first) ? first : undefined

      if (group !== undefined && !first.startsWith('-')) {
        context.stdout(rootHelp([group]))

        return 2
      }

      throw new UsageError(`Comando desconhecido: ${argv.filter((a) => !a.startsWith('-')).slice(0, 2).join(' ') || first}. Use "postal --help".`)
    }

    const { values, positionals } = parseOptions(rest, { ...command.options, ...GLOBAL_OPTIONS }, command.path.join(' '))

    if (values['help'] === true) {
      context.stdout(commandHelp(command))

      return 0
    }

    const stored = command.needsKey === false ? undefined : await resolveApiKey(context.env)

    if (command.needsKey !== false && stored === undefined) {
      throw new PostalError(
        0,
        'missing_api_key',
        'Nenhuma chave de API. Rode "postal login" ou defina a variável POSTAL_API_KEY.',
      )
    }

    const result = await command.run({
      context,
      values,
      positionals,
      postal: clientFor(context, stored?.key ?? 'ps_unused'),
      keySource: stored?.source,
      apiKey: stored?.key,
    })

    context.stdout(json ? `${JSON.stringify(result.json, null, 2)}\n` : `${result.text}\n`)

    return 0
  } catch (error) {
    if (error instanceof UsageError) {
      context.stderr(json ? `${JSON.stringify({ error: { name: 'usage_error', message: error.message } })}\n` : `Erro: ${error.message}\n`)

      return 2
    }

    if (error instanceof PostalError) {
      context.stderr(
        json
          ? `${JSON.stringify({ error: { statusCode: error.statusCode, name: error.name, message: error.message } })}\n`
          : `Erro (${error.name}${error.statusCode ? `, ${error.statusCode}` : ''}): ${error.message}\n`,
      )

      return 1
    }

    throw error
  }
}

function findCommand(argv: string[]): { command: Command | undefined; rest: string[] } {
  const words: string[] = []

  for (const arg of argv) {
    if (arg.startsWith('-')) {
      break
    }

    words.push(arg)
  }

  for (const command of commands) {
    if (command.path.every((word, index) => words[index] === word)) {
      return { command, rest: argv.slice(command.path.length) }
    }
  }

  return { command: undefined, rest: argv }
}

function rootHelp(topic: string[]): string {
  const [group] = topic
  const selected = group === undefined ? commands : commands.filter((command) => command.path[0] === group)

  if (group !== undefined && selected.length === 1 && selected[0]!.path.length === 1) {
    return commandHelp(selected[0]!)
  }

  const lines =
    group === undefined
      ? [
          'postal: CLI do Postal para enviar e-mails e eventos pelo terminal.',
          '',
          'Uso: postal <comando> [opções]',
          '',
          'Comandos:',
        ]
      : [`Uso: postal ${group} <comando> [opções]`, '', 'Comandos:']

  const width = Math.max(...selected.map((command) => command.path.join(' ').length))

  for (const command of selected) {
    lines.push(`  ${command.path.join(' ').padEnd(width)}  ${command.summary}`)
  }

  if (group === undefined) {
    lines.push(
      '',
      'Opções:',
      '  --json         Imprime o resultado em JSON (saída de máquina).',
      '  -h, --help     Mostra a ajuda (também em cada comando: postal emails send --help).',
      '  --version      Mostra a versão.',
      '',
      'Chave de API:',
      '  A variável POSTAL_API_KEY tem precedência sobre a chave guardada por "postal login"',
      '  (~/.config/postal/config.json). POSTAL_API_URL troca a URL da API (padrão https://api.postal.so).',
      '',
      'Códigos de saída: 0 deu certo, 1 erro da API ou de rede, 2 uso incorreto.',
      'Documentação: https://postal.so/docs/cli',
    )
  }

  return `${lines.join('\n')}\n`
}

function commandHelp(command: Command): string {
  const name = `postal ${command.path.join(' ')}`
  const lines = [`${name}: ${command.summary}`, '', `Uso: ${name} [opções]`]

  if (command.details) {
    lines.push('', command.details)
  }

  const options = { ...command.options, ...GLOBAL_OPTIONS }
  const labels = Object.entries(options).map(([key, spec]) => {
    const flag = `${spec.short ? `-${spec.short}, ` : ''}--${key}${spec.type === 'string' ? ` ${spec.value ?? 'VALOR'}` : ''}`

    return [flag, spec.description] as const
  })
  const width = Math.max(...labels.map(([flag]) => flag.length))

  lines.push('', 'Opções:')

  for (const [flag, description] of labels) {
    lines.push(`  ${flag.padEnd(width)}  ${description}`)
  }

  if (command.examples.length > 0) {
    lines.push('', 'Exemplos:')

    for (const example of command.examples) {
      lines.push(`  ${example}`)
    }
  }

  return `${lines.join('\n')}\n`
}
