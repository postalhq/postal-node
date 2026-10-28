import type { RequestOptions } from '../http.js'
import type {
  BatchEmailItem,
  BatchEmailResponse,
  Email,
  List,
  ListEmailsParams,
  ObjectRef,
  SendEmailParams,
  SendEmailResponse,
} from '../types.js'
import { isoDate, paginate, Resource, segment } from './base.js'

export class Emails extends Resource {
  /**
   * Sends an email (`POST /emails`).
   *
   * Without `idempotencyKey`, the SDK generates a key for this call and reuses it across
   * retries, so a repeat after a timeout or a 5xx error does not duplicate the send.
   */
  send(params: SendEmailParams, options?: RequestOptions): Promise<SendEmailResponse> {
    return this.http.post('/emails', withDates(params), { options, autoIdempotency: true })
  }

  /**
   * Sends up to 100 emails in one request (`POST /emails/batch`). Either all are queued, or none.
   */
  batch(emails: BatchEmailItem[], options?: RequestOptions): Promise<BatchEmailResponse> {
    return this.http.post('/emails/batch', emails, { options, autoIdempotency: true })
  }

  /** One email with its content and event history (`GET /emails/{id}`). */
  get(id: string, options?: RequestOptions): Promise<Email> {
    return this.http.get(`/emails/${segment(id)}`, undefined, options)
  }

  /** A page of emails, newest to oldest (`GET /emails`). Needs a full-access key. */
  list(params: ListEmailsParams = {}, options?: RequestOptions): Promise<List<Email>> {
    return this.http.get('/emails', params, options)
  }

  /** Walks through all emails matching the filter, page by page. */
  iterate(params: Omit<ListEmailsParams, 'limit'> = {}): AsyncGenerator<Email, void, undefined> {
    return paginate((page) => this.list(page), params)
  }

  /** Changes the date of a scheduled email (`PATCH /emails/{id}`). */
  update(id: string, params: { scheduled_at: string | Date }, options?: RequestOptions): Promise<ObjectRef> {
    return this.http.patch(
      `/emails/${segment(id)}`,
      { scheduled_at: isoDate(params.scheduled_at) },
      { options },
    )
  }

  /** Cancels a scheduled email (`POST /emails/{id}/cancel`). */
  cancel(id: string, options?: RequestOptions): Promise<ObjectRef> {
    return this.http.post(`/emails/${segment(id)}/cancel`, undefined, { options })
  }

  /** The message as it was sent, in RFC 5322 format (`GET /emails/{id}/raw`). */
  raw(id: string, options?: RequestOptions): Promise<string> {
    return this.http.getText(`/emails/${segment(id)}/raw`, options)
  }
}

function withDates(params: SendEmailParams): Record<string, unknown> {
  return params.scheduled_at === undefined ? { ...params } : { ...params, scheduled_at: isoDate(params.scheduled_at) }
}
