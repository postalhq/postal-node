import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { connect } from 'node:net'

/**
 * Fake HTTP server: keeps the requests and answers with whatever the test sets up.
 * `handler(request)` returns `{ status, body, headers }` (body is a JSON object or text).
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
 * A local address where connecting hangs (the connection never completes), to test the connection deadline.
 * A child process opens the port with a backlog of 1 and blocks the event loop without ever accepting; once
 * the queue fills, the kernel drops the following SYNs. Returns `null` if the environment does not reproduce this.
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
