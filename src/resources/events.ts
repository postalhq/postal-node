import type { RequestOptions } from '../http.js'
import type {
  EventName,
  List,
  ListEventsParams,
  PostalEvent,
  SendEventParams,
  SendEventResponse,
} from '../types.js'
import { isoDate, paginate, Resource, segment } from './base.js'

export class Events extends Resource {
  /**
   * Envia um evento (`POST /events`) e inicia as automações que usam esse nome como gatilho.
   * Funciona com chave só de envio. Repetir com a mesma `idempotencyKey` não registra o evento de novo.
   *
   * @example
   * await postal.events.send({ name: 'signup', contact: 'fulano@exemplo.com', properties: { plan: 'free' } })
   */
  send(params: SendEventParams, options?: RequestOptions): Promise<SendEventResponse> {
    const body = params.occurred_at === undefined ? params : { ...params, occurred_at: isoDate(params.occurred_at) }

    return this.http.post('/events', body, { options, autoIdempotency: true })
  }

  /** Uma página de eventos dos últimos 90 dias (`GET /events`). Exige chave de acesso total. */
  list(params: ListEventsParams = {}, options?: RequestOptions): Promise<List<PostalEvent>> {
    return this.http.get('/events', params, options)
  }

  iterate(params: Omit<ListEventsParams, 'limit'> = {}): AsyncGenerator<PostalEvent, void, undefined> {
    return paginate((page) => this.list(page), params)
  }

  get(id: string, options?: RequestOptions): Promise<PostalEvent> {
    return this.http.get(`/events/${segment(id)}`, undefined, options)
  }

  /** Os nomes de evento que a conta já enviou (`GET /events/names`). */
  names(options?: RequestOptions): Promise<List<EventName>> {
    return this.http.get('/events/names', undefined, options)
  }
}
