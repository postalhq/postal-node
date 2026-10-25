import { chmod, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

export interface StoredConfig {
  api_key?: string
}

export type KeySource = 'env' | 'config'

/**
 * Pasta de configuração: `$XDG_CONFIG_HOME/postal` ou `~/.config/postal`.
 */
export function configDirectory(env: Record<string, string | undefined>): string {
  const base = env['XDG_CONFIG_HOME'] ? env['XDG_CONFIG_HOME'] : join(env['HOME'] || homedir(), '.config')

  return join(base, 'postal')
}

export function configPath(env: Record<string, string | undefined>): string {
  return join(configDirectory(env), 'config.json')
}

export async function readConfig(env: Record<string, string | undefined>): Promise<StoredConfig> {
  try {
    const parsed: unknown = JSON.parse(await readFile(configPath(env), 'utf8'))

    return parsed !== null && typeof parsed === 'object' ? (parsed as StoredConfig) : {}
  } catch {
    return {}
  }
}

/**
 * Grava a chave em `config.json` com modo 0600 (pasta 0700).
 */
export async function writeConfig(env: Record<string, string | undefined>, config: StoredConfig): Promise<string> {
  const path = configPath(env)

  await mkdir(configDirectory(env), { recursive: true, mode: 0o700 })
  await writeFile(path, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 })
  await chmod(path, 0o600)

  return path
}

export async function removeConfig(env: Record<string, string | undefined>): Promise<boolean> {
  const path = configPath(env)

  try {
    await readFile(path)
  } catch {
    return false
  }

  await rm(path, { force: true })

  return true
}

/**
 * A chave a usar: `POSTAL_API_KEY` tem precedência sobre o arquivo.
 */
export async function resolveApiKey(
  env: Record<string, string | undefined>,
): Promise<{ key: string; source: KeySource } | undefined> {
  const fromEnv = env['POSTAL_API_KEY']?.trim()

  if (fromEnv) {
    return { key: fromEnv, source: 'env' }
  }

  const stored = (await readConfig(env)).api_key?.trim()

  return stored ? { key: stored, source: 'config' } : undefined
}

export function maskKey(key: string): string {
  return key.length <= 8 ? '********' : `${key.slice(0, 6)}…${key.slice(-2)}`
}
