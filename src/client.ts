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

  /**
   * O limite de requisições dos cabeçalhos da última resposta (`X-RateLimit-Limit`, `X-RateLimit-Remaining` e,
   * na 429, `Retry-After` e `X-RateLimit-Reset`), inclusive de respostas de erro.
   *
   * Funciona com chave só de envio e não faz requisição extra (diferente de `usage()`). É `null` até chegar uma
   * resposta com esses cabeçalhos; uma resposta sem eles mantém o último valor conhecido.
   */
  get rateLimit(): RateLimit | null {
    return this.http.rateLimit
  }

  /** Plano, cotas e limite de requisições da conta (`GET /usage`). Funciona com chave de acesso total ou só de envio (a chave só de envio não vê os créditos). */
  usage(options?: RequestOptions): Promise<Usage> {
    return this.http.get('/usage', undefined, options)
  }
}
