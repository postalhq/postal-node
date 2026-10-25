import type { Fetch } from '../http.js'

/**
 * Tudo que o CLI precisa do mundo exterior; nos testes, cada item é trocado por um falso.
 */
export interface CliContext {
  env: Record<string, string | undefined>
  stdout: (text: string) => void
  stderr: (text: string) => void
  /** Lê um segredo sem mostrá-lo na tela (ou da entrada padrão, se não for um terminal). */
  readSecret: (prompt: string) => Promise<string>
  fetch?: Fetch
  retryDelay?: number
  version: string
}
