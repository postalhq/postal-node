import type { HttpClient } from '../http.js'
import type { List, ListParams } from '../types.js'

export abstract class Resource {
  constructor(protected readonly http: HttpClient) {}
}

/**
 * Codifica um ID ou e-mail para ir no caminho da URL.
 */
export function segment(value: string): string {
  return encodeURIComponent(value)
}

/**
 * Converte `Date` em ISO 8601 e deixa o resto como está.
 */
export function isoDate(value: string | Date | undefined): string | undefined {
  return value instanceof Date ? value.toISOString() : value
}

/**
 * Percorre todas as páginas de uma lista, de 100 em 100, seguindo `after` até `has_more` ser falso.
 */
export async function* paginate<T extends { id: string }, P extends ListParams>(
  fetchPage: (params: P) => Promise<List<T>>,
  params: P,
): AsyncGenerator<T, void, undefined> {
  let after = params.after

  for (;;) {
    const page = await fetchPage({ ...params, limit: 100, ...(after !== undefined ? { after } : {}) })

    yield* page.data

    const last = page.data.at(-1)

    if (!page.has_more || last === undefined) {
      return
    }

    after = last.id
  }
}
