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
   * Sends an event (`POST /events`) and starts the automations that use that name as a trigger.
   * Works with a sending-only key. Repeating with the same `idempotencyKey` does not record the event again.
   *
   * @example
   * await postal.events.send({ name: 'signup', contact: 'jane@example.com', properties: { plan: 'free' } })
   */
  send(params: SendEventParams, options?: RequestOptions): Promise<SendEventResponse> {
    const body = params.occurred_at === undefined ? params : { ...params, occurred_at: isoDate(params.occurred_at) }

    return this.http.post('/events', body, { options, autoIdempotency: true })
  }

  /** A page of events from the last 90 days (`GET /events`). Needs a full-access key. */
  list(params: ListEventsParams = {}, options?: RequestOptions): Promise<List<PostalEvent>> {
    return this.http.get('/events', params, options)
  }

  iterate(params: Omit<ListEventsParams, 'limit'> = {}): AsyncGenerator<PostalEvent, void, undefined> {
    return paginate((page) => this.list(page), params)
  }

  get(id: string, options?: RequestOptions): Promise<PostalEvent> {
    return this.http.get(`/events/${segment(id)}`, undefined, options)
  }

  /** The event names the account has already sent (`GET /events/names`). */
  names(options?: RequestOptions): Promise<List<EventName>> {
    return this.http.get('/events/names', undefined, options)
  }
}
