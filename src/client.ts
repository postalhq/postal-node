import { HttpClient, type ClientOptions, type RequestOptions } from './http.js'
import { Contacts } from './resources/contacts.js'
import { Domains } from './resources/domains.js'
import { Emails } from './resources/emails.js'
import { Events } from './resources/events.js'
import { Segments } from './resources/segments.js'
import { Topics } from './resources/topics.js'
import { Webhooks } from './resources/webhooks.js'
import type { RateLimit } from './rate-limit.js'
import type { Usage } from './types.js'

/**
 * Postal API client.
 *
 * @example
 * import { Postal } from 'postal-so'
 *
 * const postal = new Postal(process.env.POSTAL_API_KEY)
 * await postal.emails.send({
 *   from: 'Acme Store <you@yourdomain.com>',
 *   to: 'jane@example.com',
 *   subject: 'Hello',
 *   html: '<p>Welcome!</p>',
 * })
 */
export class Postal {
  readonly emails: Emails
  readonly contacts: Contacts
  readonly events: Events
  readonly segments: Segments
  readonly topics: Topics
  readonly domains: Domains
  readonly webhooks: Webhooks

  private readonly http: HttpClient

  /**
   * @param apiKey API key (`ps_...`) or the client options. Without a key, uses `POSTAL_API_KEY`.
   */
  constructor(apiKey?: string | ClientOptions, options: Omit<ClientOptions, 'apiKey'> = {}) {
    this.http = new HttpClient(typeof apiKey === 'object' ? apiKey : { ...options, ...(apiKey ? { apiKey } : {}) })
    this.emails = new Emails(this.http)
    this.contacts = new Contacts(this.http)
    this.events = new Events(this.http)
    this.segments = new Segments(this.http)
    this.topics = new Topics(this.http)
    this.domains = new Domains(this.http)
    this.webhooks = new Webhooks(this.http)
  }

  /**
   * The request limit from the headers of the last response (`X-RateLimit-Limit`, `X-RateLimit-Remaining` and,
   * on a 429, `Retry-After` and `X-RateLimit-Reset`), including error responses.
   *
   * Works with a sending-only key and makes no extra request (unlike `usage()`). It is `null` until a
   * response with those headers arrives; a response without them keeps the last known value.
   */
  get rateLimit(): RateLimit | null {
    return this.http.rateLimit
  }

  /** The account's plan, quotas and request limit (`GET /usage`). Works with a full-access or a sending-only key (a sending-only key does not see the credits). */
  usage(options?: RequestOptions): Promise<Usage> {
    return this.http.get('/usage', undefined, options)
  }
}
