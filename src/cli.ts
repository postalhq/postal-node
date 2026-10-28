#!/usr/bin/env node
import { createInterface } from 'node:readline'
import { run, type CliContext } from './cli/index.js'
import { VERSION } from './http.js'

/**
 * Reads the key without showing it on screen; outside a terminal, reads a line from standard input.
 */
function readSecret(prompt: string): Promise<string> {
  const { stdin, stderr } = process

  if (!stdin.isTTY) {
    return new Promise((resolve) => {
      const reader = createInterface({ input: stdin })
      let answered = false

      reader.once('line', (line) => {
        answered = true
        resolve(line)
        reader.close()
      })
      reader.once('close', () => {
        if (!answered) {
          resolve('')
        }
      })
    })
  }

  return new Promise((resolve, reject) => {
    let value = ''

    stderr.write(prompt)
    stdin.setRawMode(true)
    stdin.resume()
    stdin.setEncoding('utf8')

    const finish = (): void => {
      stdin.setRawMode(false)
      stdin.pause()
      stdin.removeListener('data', onData)
      stderr.write('\n')
    }
    const onData = (chunk: string): void => {
      for (const char of chunk) {
        if (char === '\r' || char === '\n') {
          finish()
          resolve(value)

          return
        }

        if (char === '\u0003') {
          finish()
          reject(new Error('Cancelado.'))

          return
        }

        if (char === '\u007f' || char === '\b') {
          value = value.slice(0, -1)
        } else if (char >= ' ') {
          value += char
        }
      }
    }

    stdin.on('data', onData)
  })
}

const context: CliContext = {
  env: process.env,
  stdout: (text) => void process.stdout.write(text),
  stderr: (text) => void process.stderr.write(text),
  readSecret,
  version: VERSION,
}

run(process.argv.slice(2), context).then(
  (code) => {
    process.exitCode = code
  },
  (error: unknown) => {
    process.stderr.write(`Erro inesperado: ${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  },
)
