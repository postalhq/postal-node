import { HttpClient, type ClientOptions, type RequestOptions } from './http.js'
import { Contacts } from './resources/contacts.js'
import { Domains } from './resources/domains.js'
import { Emails } from './resources/emails.js'
import { Events } from './resources/events.js'
import { Segments } from './resources/segments.js'
import { Topics } from './resources/topics.js'
import { Webhooks } from './resources/webhooks.js'
import type { Usage } from './types.js'

/**
 * Cliente da API do Postal.
 *
 * @example
 * import { Postal } from 'postal-so'
 *
 * const postal = new Postal(process.env.POSTAL_API_KEY)
 * await postal.emails.send({
 *   from: 'Minha empresa <voce@seudominio.com.br>',
 *   to: 'fulano@exemplo.com',
 *   subject: 'Olá',
 *   html: '<p>Bem-vindo!</p>',
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
   * @param apiKey Chave de API (`ps_...`) ou as opções do cliente. Sem chave, usa `POSTAL_API_KEY`.
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

  /** Plano, cotas e limite de requisições da conta (`GET /usage`). Exige chave de acesso total. */
  usage(options?: RequestOptions): Promise<Usage> {
    return this.http.get('/usage', undefined, options)
  }
}
