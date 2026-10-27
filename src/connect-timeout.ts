import { subscribe } from 'node:diagnostics_channel'

/**
 * O `fetch` não tem um tempo limite só para a conexão. No Node, o `fetch` global usa o undici, que avisa pelo
 * `diagnostics_channel` quando a conexão está pronta e os cabeçalhos da requisição vão ser enviados
 * (`undici:client:sendHeaders`). O prazo de conexão é um temporizador iniciado antes do `fetch` e cancelado
 * nesse aviso; se estourar, a tentativa é abortada.
 *
 * Só vale para o `fetch` global do Node (`process.versions.undici`). Com um `fetch` próprio, ou em runtimes
 * sem undici, não há como saber quando a conexão abriu e o prazo não é aplicado (continua valendo `timeout`).
 */
interface Pending {
  origin: string
  method: string
  path: string
  connected: () => void
}

interface UndiciRequestMessage {
  request?: { origin?: unknown; method?: unknown; path?: unknown }
}

const pending = new Set<Pending>()
let subscribed = false

function onSendHeaders(message: unknown): void {
  const request = (message as UndiciRequestMessage | undefined)?.request

  if (request === undefined) {
    return
  }

  for (const candidate of pending) {
    if (candidate.origin === request.origin && candidate.method === request.method && candidate.path === request.path) {
      candidate.connected()

      return
    }
  }
}

/**
 * Diz se o runtime avisa quando a conexão abre (o `fetch` global do Node com undici).
 */
export function canWatchConnection(): boolean {
  return typeof process !== 'undefined' && typeof process.versions?.['undici'] === 'string'
}

/**
 * Começa a contar o prazo de conexão de uma requisição. Chame `onTimeout` se a conexão não abrir em
 * `milliseconds`. Devolve a função que encerra a vigilância (chame-a sempre, no `finally`).
 */
export function watchConnection(
  url: string,
  method: string,
  milliseconds: number,
  onTimeout: () => void,
): () => void {
  if (!subscribed) {
    subscribe('undici:client:sendHeaders', onSendHeaders)
    subscribed = true
  }

  const target = new URL(url)
  const entry: Pending = {
    origin: target.origin,
    method,
    path: target.pathname + target.search,
    connected: () => stop(),
  }
  const timer = setTimeout(() => {
    pending.delete(entry)
    onTimeout()
  }, milliseconds)
  const stop = (): void => {
    clearTimeout(timer)
    pending.delete(entry)
  }

  pending.add(entry)

  return stop
}
