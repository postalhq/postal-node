import { readFile } from 'node:fs/promises'
import { parseArgs, type ParseArgsConfig } from 'node:util'

export class UsageError extends Error {}

export interface OptionSpec {
  type: 'string' | 'boolean'
  multiple?: boolean
  short?: string
  /** Texto de ajuda (português). */
  description: string
  /** Nome do valor na ajuda, como `EMAIL`. */
  value?: string
}

export type OptionSpecs = Record<string, OptionSpec>

export type ParsedValues = Record<string, string | boolean | (string | boolean)[] | undefined>

/**
 * Lê as opções de um comando, com mensagens de erro em português.
 */
export function parseOptions(
  args: string[],
  specs: OptionSpecs,
  commandName: string,
): { values: ParsedValues; positionals: string[] } {
  try {
    const { values, positionals } = parseArgs({
      args,
      allowPositionals: true,
      strict: true,
      options: Object.fromEntries(
        Object.entries(specs).map(([name, spec]) => [
          name,
          {
            type: spec.type,
            ...(spec.multiple ? { multiple: true } : {}),
            ...(spec.short ? { short: spec.short } : {}),
          },
        ]),
      ) as NonNullable<ParseArgsConfig['options']>,
    })

    return { values: values as ParsedValues, positionals }
  } catch (error) {
    const code = (error as { code?: string }).code
    const help = `Use "postal ${commandName} --help".`

    if (code === 'ERR_PARSE_ARGS_UNKNOWN_OPTION') {
      const option = /'(-[^']+)'/.exec((error as Error).message)?.[1] ?? 'opção'

      throw new UsageError(`Opção desconhecida: ${option}. ${help}`)
    }

    if (code === 'ERR_PARSE_ARGS_INVALID_OPTION_VALUE') {
      const option = /'(-[^']+)'/.exec((error as Error).message)?.[1] ?? 'opção'

      throw new UsageError(`A opção ${option} precisa de um valor. ${help}`)
    }

    throw new UsageError(`${(error as Error).message} ${help}`)
  }
}

export function stringOption(values: ParsedValues, name: string): string | undefined {
  const value = values[name]
  const last = Array.isArray(value) ? value.at(-1) : value

  return typeof last === 'string' && last !== '' ? last : undefined
}

export function listOption(values: ParsedValues, name: string): string[] {
  const value = values[name]

  if (value === undefined) {
    return []
  }

  return (Array.isArray(value) ? value : [value]).filter((item): item is string => typeof item === 'string' && item !== '')
}

export function flagOption(values: ParsedValues, name: string): boolean {
  return values[name] === true
}

/**
 * Divide `a@x.com, "Fulano, Jr" <b@y.com>` por vírgulas fora de aspas e de `<...>`.
 */
export function splitAddresses(values: string[]): string[] {
  const result: string[] = []

  for (const value of values) {
    let current = ''
    let quoted = false
    let angle = false

    for (const char of value) {
      if (char === '"') {
        quoted = !quoted
      } else if (char === '<' && !quoted) {
        angle = true
      } else if (char === '>' && !quoted) {
        angle = false
      }

      if (char === ',' && !quoted && !angle) {
        result.push(current.trim())
        current = ''
      } else {
        current += char
      }
    }

    result.push(current.trim())
  }

  return result.filter((item) => item !== '')
}

/**
 * Um valor que começa com `@` é o caminho de um arquivo (`--html @email.html`).
 */
export async function textOrFile(value: string | undefined, name: string): Promise<string | undefined> {
  if (value === undefined || !value.startsWith('@')) {
    return value
  }

  try {
    return await readFile(value.slice(1), 'utf8')
  } catch {
    throw new UsageError(`Não consegui ler o arquivo de --${name}: ${value.slice(1)}`)
  }
}

export function parseJsonObject(value: string | undefined, name: string): Record<string, unknown> | undefined {
  if (value === undefined) {
    return undefined
  }

  try {
    const parsed: unknown = JSON.parse(value)

    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('não é um objeto')
    }

    return parsed as Record<string, unknown>
  } catch {
    throw new UsageError(`--${name} precisa ser um objeto JSON, como '{"plano":"pro"}'.`)
  }
}

/**
 * `NOME=valor` repetido vira `{ NOME: 'valor' }`.
 */
export function parsePairs(values: string[], name: string): Record<string, string> {
  const result: Record<string, string> = {}

  for (const item of values) {
    const separator = item.indexOf('=')

    if (separator < 1) {
      throw new UsageError(`--${name} precisa estar no formato NOME=valor (recebi "${item}").`)
    }

    result[item.slice(0, separator)] = item.slice(separator + 1)
  }

  return result
}
