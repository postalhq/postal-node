import { PostalError } from '../errors.js'
import type { RequestOptions } from '../http.js'
import type {
  Contact,
  ContactBatchResponse,
  ContactTopicChoice,
  CreateContactParams,
  Deleted,
  List,
  ListContactsParams,
  ObjectRef,
  UpdateContactParams,
  UpsertContactParams,
  UpsertContactResult,
} from '../types.js'
import { paginate, Resource, segment } from './base.js'

/**
 * Where the documentation says "contact ID", the email or `external_id:<id>` works too.
 */
export class Contacts extends Resource {
  /** Creates a contact (`POST /contacts`). Fails if the email or the `external_id` already exist. */
  create(params: CreateContactParams, options?: RequestOptions): Promise<ObjectRef> {
    return this.http.post('/contacts', params, { options })
  }

  /**
   * Creates or updates a contact, looking it up by `id`, then `external_id`, then `email`
   * (`POST /contacts/batch` with one item). Repeating the call is safe.
   *
   * @example
   * await postal.contacts.upsert({ external_id: 'user_42', email: 'jane@example.com', first_name: 'Jane' })
   */
  async upsert(params: UpsertContactParams, options?: RequestOptions): Promise<UpsertContactResult> {
    const response = await this.http.post<ContactBatchResponse>(
      '/contacts/batch',
      { contacts: [params] },
      { options, idempotent: true },
    )
    const result = response.results?.[0]

    if (result === undefined) {
      throw new PostalError(502, 'invalid_response', 'Postal did not return the contact result.')
    }

    if (result.status === 'failed') {
      throw new PostalError(422, 'validation_error', result.error ?? 'The contact could not be saved.')
    }

    return result as UpsertContactResult
  }

  /**
   * Creates or updates several contacts at once (`POST /contacts/batch`). Up to 1,000 items, the response carries
   * one result per item (an item with an error does not bring down the others); above that the batch goes to the queue.
   */
  batch(contacts: UpsertContactParams[], options?: RequestOptions): Promise<ContactBatchResponse> {
    return this.http.post('/contacts/batch', { contacts }, { options, idempotent: true })
  }

  /** One contact by ID, email or `external_id:<id>` (`GET /contacts/{id}`). */
  get(idOrEmail: string, options?: RequestOptions): Promise<Contact> {
    return this.http.get(`/contacts/${segment(idOrEmail)}`, undefined, options)
  }

  /** One contact by `external_id` (its ID in your system). */
  getByExternalId(externalId: string, options?: RequestOptions): Promise<Contact> {
    return this.get(`external_id:${externalId}`, options)
  }

  /** Updates only the fields sent (`PATCH /contacts/{id}`). */
  update(idOrEmail: string, params: UpdateContactParams, options?: RequestOptions): Promise<ObjectRef> {
    return this.http.patch(`/contacts/${segment(idOrEmail)}`, params, { options })
  }

  /** Removes the contact from the audience (`DELETE /contacts/{id}`). To just stop sending, use `unsubscribed: true`. */
  delete(idOrEmail: string, options?: RequestOptions): Promise<Deleted> {
    return this.http.delete(`/contacts/${segment(idOrEmail)}`, options)
  }

  /** A page of contacts, newest to oldest (`GET /contacts`). */
  list(params: ListContactsParams = {}, options?: RequestOptions): Promise<List<Contact>> {
    return this.http.get('/contacts', params, options)
  }

  /** Walks through all contacts matching the filter, page by page. */
  iterate(params: Omit<ListContactsParams, 'limit'> = {}): AsyncGenerator<Contact, void, undefined> {
    return paginate((page) => this.list(page), params)
  }

  /** Puts the contact in a static segment (`POST /contacts/{id}/segments/{segment_id}`). */
  addToSegment(idOrEmail: string, segmentId: string, options?: RequestOptions): Promise<unknown> {
    return this.http.post(`/contacts/${segment(idOrEmail)}/segments/${segment(segmentId)}`, undefined, { options })
  }

  /** Takes the contact out of a static segment (`DELETE /contacts/{id}/segments/{segment_id}`). */
  removeFromSegment(idOrEmail: string, segmentId: string, options?: RequestOptions): Promise<unknown> {
    return this.http.delete(`/contacts/${segment(idOrEmail)}/segments/${segment(segmentId)}`, options)
  }

  /** Records the contact's choice on topics (`PATCH /contacts/{id}/topics`). */
  updateTopics(idOrEmail: string, topics: ContactTopicChoice[], options?: RequestOptions): Promise<ObjectRef> {
    return this.http.patch(`/contacts/${segment(idOrEmail)}/topics`, { topics }, { options })
  }
}
