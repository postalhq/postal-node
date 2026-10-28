import { subscribe } from 'node:diagnostics_channel'

/**
 * `fetch` has no timeout just for the connection. In Node, the global `fetch` uses undici, which announces through
 * `diagnostics_channel` when the connection is ready and the request headers are about to be sent
 * (`undici:client:sendHeaders`). The connection deadline is a timer started before `fetch` and canceled
 * at that notice; if it runs out, the attempt is aborted.
 *
 * It only applies to Node's global `fetch` (`process.versions.undici`). With your own `fetch`, or on runtimes
 * without undici, there is no way to know when the connection opened and the deadline is not applied (`timeout` still counts).
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
 * Tells whether the runtime announces when the connection opens (Node's global `fetch` with undici).
 */
export function canWatchConnection(): boolean {
  return typeof process !== 'undefined' && typeof process.versions?.['undici'] === 'string'
}

/**
 * Starts counting the connection deadline of a request. Call `onTimeout` if the connection does not open within
 * `milliseconds`. Returns the function that ends the watch (always call it, in the `finally`).
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
