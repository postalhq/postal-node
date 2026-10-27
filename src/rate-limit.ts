/**
 * Limite de requisições por segundo lido dos cabeçalhos de uma resposta do Postal.
 *
 * Toda resposta traz `X-RateLimit-Limit` e `X-RateLimit-Remaining`; a `429` traz também `Retry-After` e
 * `X-RateLimit-Reset`. Os campos ausentes ficam `null`. Não exige chave de acesso total (diferente de
 * `usage()`) e não faz requisição extra.
 */
export interface RateLimit {
  /** Requisições permitidas por segundo (`X-RateLimit-Limit`). */
  limit: number | null
  /** Quantas ainda cabem na janela atual (`X-RateLimit-Remaining`). */
  remaining: number | null
  /** Segundos para esperar antes de tentar de novo (`Retry-After`, só na 429). */
  retryAfter: number | null
  /** Quando o limite volta, em timestamp Unix em segundos (`X-RateLimit-Reset`, só na 429). */
  resetAt: number | null
}

function integer(value: string | null): number | null {
  const trimmed = value?.trim()

  return trimmed !== undefined && /^\d+$/.test(trimmed) ? Number(trimmed) : null
}

/**
 * Lê os cabeçalhos de uma resposta. Devolve `null` quando nenhum dos quatro veio.
 */
export function parseRateLimit(headers: Headers): RateLimit | null {
  const rateLimit: RateLimit = {
    limit: integer(headers.get('x-ratelimit-limit')),
    remaining: integer(headers.get('x-ratelimit-remaining')),
    retryAfter: integer(headers.get('retry-after')),
    resetAt: integer(headers.get('x-ratelimit-reset')),
  }

  return Object.values(rateLimit).every((value) => value === null) ? null : rateLimit
}
