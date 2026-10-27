import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { connect } from 'node:net'

/**
 * Servidor HTTP falso: guarda as requisições e responde com o que o teste programar.
 * `handler(request)` devolve `{ status, body, headers }` (body é objeto JSON ou texto).
 */
export async function fakeServer(handler) {
  const requests = []
  const server = createServer(async (req, res) => {
    const chunks = []

    for await (const chunk of req) {
      chunks.push(chunk)
    }

    const raw = Buffer.concat(chunks).toString('utf8')
    const request = {
      method: req.method,
      url: req.url,
      headers: req.headers,
      raw,
      body: raw === '' ? undefined : JSON.parse(raw),
    }

    requests.push(request)

    const reply = (await handler(request, requests.length)) ?? { status: 200, body: {} }
    const text = typeof reply.body === 'string' ? reply.body : JSON.stringify(reply.body ?? {})

    res.writeHead(reply.status ?? 200, {
      'content-type': typeof reply.body === 'string' ? 'text/plain' : 'application/json',
      ...(reply.headers ?? {}),
    })
    res.end(text)
  })

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))

  return {
    requests,
    baseUrl: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((resolve) => {
      server.closeAllConnections?.()
      server.close(resolve)
    }),
  }
}

export function apiError(status, name, message, headers = {}) {
  return { status, body: { statusCode: status, name, message }, headers }
}

/**
 * Um endereço local onde conectar fica pendente (a conexão nunca completa), para testar o prazo de conexão.
 * Um processo filho abre a porta com fila de 1 e trava o laço de eventos sem nunca aceitar; depois que
 * a fila enche, o kernel descarta os SYN seguintes. Devolve `null` se o ambiente não reproduzir isso.
 */
export async function hangingServer() {
  const child = spawn(
    process.execPath,
    [
      '-e',
      `require('node:net').createServer().listen({ port: 0, host: '127.0.0.1', backlog: 1 }, function () {
        console.log(this.address().port)
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 120000)
      })`,
    ],
    { stdio: ['ignore', 'pipe', 'ignore'] },
  )
  const sockets = []
  const close = async () => {
    sockets.forEach((socket) => socket.destroy())
    child.kill('SIGKILL')
    await new Promise((resolve) => child.once('exit', resolve))
  }
  const port = await new Promise((resolve) => child.stdout.once('data', (data) => resolve(Number(String(data).trim()))))

  for (let i = 0; i < 6; i++) {
    sockets.push(connect({ port, host: '127.0.0.1' }).on('error', () => {}))
  }

  const probe = connect({ port, host: '127.0.0.1' }).on('error', () => {})
  const hangs = await new Promise((resolve) => {
    probe.once('connect', () => resolve(false))
    setTimeout(() => resolve(true), 300)
  })

  probe.destroy()

  if (!hangs) {
    await close()

    return null
  }

  return { baseUrl: `http://127.0.0.1:${port}`, close }
}
