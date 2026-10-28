import type { Fetch } from '../http.js'

/**
 * Everything the CLI needs from the outside world; in tests, each item is swapped for a fake.
 */
export interface CliContext {
  env: Record<string, string | undefined>
  stdout: (text: string) => void
  stderr: (text: string) => void
  /** Reads a secret without showing it on screen (or from standard input, if it is not a terminal). */
  readSecret: (prompt: string) => Promise<string>
  fetch?: Fetch
  retryDelay?: number
  version: string
}
