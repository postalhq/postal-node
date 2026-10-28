import type { HttpClient } from '../http.js'
import type { List, ListParams } from '../types.js'

export abstract class Resource {
  constructor(protected readonly http: HttpClient) {}
}

/**
 * Encodes an ID or email to go in the URL path.
 */
export function segment(value: string): string {
  return encodeURIComponent(value)
}

/**
 * Converts a `Date` to ISO 8601 and leaves the rest as it is.
 */
export function isoDate(value: string | Date | undefined): string | undefined {
  return value instanceof Date ? value.toISOString() : value
}

/**
 * Walks through all the pages of a list, 100 at a time, following `after` until `has_more` is false.
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
