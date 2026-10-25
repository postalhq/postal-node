import { createServer } from 'node:http'

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
