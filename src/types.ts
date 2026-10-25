/**
 * Tipos da API do Postal. Os nomes dos campos são os mesmos da API (snake_case),
 * então a documentação em https://postal.so/docs vale diretamente para o SDK.
 */

export interface ListParams {
  /** Itens por página, de 1 a 100. Padrão: 20. */
  limit?: number
  /** ID do último item recebido: devolve os itens mais antigos que ele. */
  after?: string
  /** ID do primeiro item recebido: devolve os itens mais recentes que ele. */
  before?: string
}

export interface List<T> {
  object: 'list'
  has_more: boolean
  data: T[]
}

export interface Deleted {
  object: string
  id: string
  deleted: true
}

export interface ObjectRef {
  object: string
  id: string
}

export type Json = string | number | boolean | null | Json[] | { [key: string]: Json }

/* ---------------------------------------------------------------- E-mails */

export interface EmailTag {
  /** Letras ASCII, números, `_` ou `-`. Não pode começar com `postal_`. */
  name: string
  value?: string
}

export interface EmailAttachment {
  /** Conteúdo do arquivo em Base64. Obrigatório sem `path`. */
  content?: string
  /** URL pública de onde o Postal baixa o arquivo. Obrigatório sem `content`. */
  path?: string
  filename?: string
  content_type?: string
  /** Para imagens embutidas: `<img src="cid:logo">` e `content_id: "logo"`. */
  content_id?: string
}

export interface EmailTemplateRef {
  /** ID ou alias do template publicado. */
  id: string
  variables?: Record<string, string | number | boolean>
}

interface EmailCommon {
  to: string | string[]
  cc?: string | string[]
  bcc?: string | string[]
  reply_to?: string | string[]
  headers?: Record<string, string>
  tags?: EmailTag[]
}

/** E-mail com conteúdo próprio. Precisa de `html` ou `text`. */
export interface ContentEmailParams extends EmailCommon {
  /** `email@dominio.com` ou `Nome <email@dominio.com>`. O domínio precisa estar verificado. */
  from: string
  subject: string
  html?: string
  text?: string
  template?: undefined
  attachments?: EmailAttachment[]
  /** Data de envio (ISO 8601 ou `Date`), no futuro e a no máximo 30 dias. */
  scheduled_at?: string | Date
}

/** E-mail com um template publicado. `from`, `subject` e `reply_to` vêm do template se não forem enviados. */
export interface TemplateEmailParams extends EmailCommon {
  from?: string
  subject?: string
  template: EmailTemplateRef
  html?: undefined
  text?: undefined
  attachments?: EmailAttachment[]
  scheduled_at?: string | Date
}

export type SendEmailParams = ContentEmailParams | TemplateEmailParams

/** Item de `emails.batch`: como `SendEmailParams`, sem anexos nem agendamento. */
export type BatchEmailItem =
  | Omit<ContentEmailParams, 'attachments' | 'scheduled_at'>
  | Omit<TemplateEmailParams, 'attachments' | 'scheduled_at'>

export interface SendEmailResponse {
  id: string
}

export interface BatchEmailResponse {
  data: SendEmailResponse[]
}

export type EmailStatus =
  | 'queued'
  | 'scheduled'
  | 'sent'
  | 'delivery_delayed'
  | 'delivered'
  | 'opened'
  | 'clicked'
  | 'bounced'
  | 'complained'
  | 'failed'
  | 'suppressed'
  | 'canceled'

export interface EmailEvent {
  type: string
  occurred_at: string
  data: Json
}

export interface Email {
  object: 'email'
  id: string
  message_id: string
  to: string[]
  from: string
  created_at: string
  subject: string
  html?: string | null
  text?: string | null
  bcc?: string[]
  cc?: string[]
  reply_to?: string[]
  last_event: EmailStatus
  scheduled_at: string | null
  tags?: EmailTag[]
  /** Só em `emails.get`. */
  events?: EmailEvent[]
  domain_id?: string
  api_key_id?: string | null
  template_id?: string | null
  source?: 'api' | 'smtp'
  log_id?: string | null
}

export interface ListEmailsParams extends ListParams {
  search?: string
  /** Um ou mais status. */
  status?: EmailStatus | EmailStatus[]
  domain_id?: string
  api_key_id?: string
  start_date?: string
  end_date?: string
}

/* --------------------------------------------------------------- Contatos */

export interface ContactTopicChoice {
  id: string
  subscription: 'opt_in' | 'opt_out'
}

export interface Contact {
  object: 'contact'
  id: string
  email: string
  external_id: string | null
  /** Alias de `external_id`. */
  user_id: string | null
  first_name: string | null
  last_name: string | null
  unsubscribed: boolean
  email_status?: string | null
  email_verified_at?: string | null
  properties: Record<string, Json>
  last_change_source?: string | null
  created_at: string
  updated_at: string
  segments?: { id: string; name: string }[]
  tags?: { id: string; name: string }[]
}

export interface CreateContactParams {
  email: string
  /** ID da pessoa no seu sistema. Único por conta. */
  external_id?: string | null
  first_name?: string | null
  last_name?: string | null
  unsubscribed?: boolean
  /** Valores das propriedades de contato; cada chave precisa existir antes. */
  properties?: Record<string, Json>
  /** IDs de segmentos estáticos. */
  segments?: string[]
  topics?: ContactTopicChoice[]
  /** IDs ou nomes de tags (nomes novos são criados). */
  tags?: string[]
}

export interface UpdateContactParams {
  email?: string
  external_id?: string | null
  first_name?: string | null
  last_name?: string | null
  unsubscribed?: boolean
  /** Só as chaves enviadas mudam; `null` ou `""` apaga o valor. */
  properties?: Record<string, Json>
  /** Substitui as tags do contato. */
  tags?: string[]
}

export interface UpsertContactParams {
  /** Procura o contato primeiro por `id`, depois por `external_id`, depois por `email`. */
  id?: string
  external_id?: string
  /** Obrigatório para criar um contato novo. */
  email?: string
  first_name?: string | null
  last_name?: string | null
  unsubscribed?: boolean
  /** Para reinscrever quem já se descadastrou: quando e como a pessoa consentiu. */
  resubscribe?: { consented_at: string; proof: string }
  properties?: Record<string, Json>
  /** Tags e segmentos são só adicionados, nunca removidos. */
  tags?: string[]
  segments?: string[]
  topics?: ContactTopicChoice[]
}

export interface UpsertContactResult {
  index: number
  status: 'created' | 'updated' | 'unchanged'
  id: string
  external_id: string | null
  email: string
  warnings?: string[]
}

export interface ContactBatchItemResult {
  index: number
  status: 'created' | 'updated' | 'unchanged' | 'failed'
  id: string | null
  external_id: string | null
  email: string | null
  error?: string
  warnings?: string[]
}

export interface ContactBatchResponse {
  object: 'contact_batch'
  id?: string
  status: 'completed' | 'queued' | 'processing' | 'failed'
  total: number
  counts?: { created: number; updated: number; unchanged: number; failed: number }
  results?: ContactBatchItemResult[]
}

export interface ListContactsParams extends ListParams {
  search?: string
  segment_id?: string
  topic_id?: string
  unsubscribed?: boolean
}

/* ----------------------------------------------------------------- Eventos */

export interface SendEventParams {
  /** Letras, números, `.`, `_`, `:` e `-`; até 100 caracteres. Ex.: `signup`, `order.paid`. */
  name: string
  /**
   * Quem fez: e-mail, ID do contato, `external_id:<id>` ou um objeto.
   * Um e-mail desconhecido cria o contato.
   */
  contact?:
    | string
    | {
        id?: string
        email?: string
        external_id?: string
        first_name?: string
        last_name?: string
      }
  /** ID da pessoa no seu sistema (alternativa a `contact`). */
  external_id?: string
  /** Dados do evento (até 16 KB), disponíveis nas automações e nos e-mails. */
  properties?: Record<string, Json>
  /** Propriedades do contato a atualizar antes de iniciar as automações. */
  contact_properties?: Record<string, Json>
  /** ISO 8601 ou `Date`. Padrão: agora. */
  occurred_at?: string | Date
}

export interface SendEventResponse {
  object: 'event'
  id: string
  contact_id: string | null
}

export interface PostalEvent {
  object: 'event'
  id: string
  name: string
  contact_id: string | null
  contact_email?: string | null
  properties: Record<string, Json>
  occurred_at: string
  created_at: string
}

export interface ListEventsParams extends ListParams {
  name?: string | string[]
  /** ID ou e-mail do contato. */
  contact?: string
}

export interface EventName {
  name: string
  count: number
  last_seen_at: string
}

/* --------------------------------------------------- Segmentos e tópicos */

export interface Segment {
  object: 'segment'
  id: string
  name: string
  description: string | null
  contacts_count?: number
  created_at?: string
  updated_at?: string
}

export interface CreateSegmentParams {
  name: string
  description?: string | null
}

export interface UpdateSegmentParams {
  name?: string
  description?: string | null
}

export interface ListSegmentsParams extends ListParams {
  search?: string
}

export interface Topic {
  object: 'topic'
  id: string
  name: string
  description: string | null
  default_subscription: 'opt_in' | 'opt_out'
  visibility: 'public' | 'private'
  created_at: string
  updated_at: string
}

export interface CreateTopicParams {
  name: string
  /** Não muda depois de criado. */
  default_subscription: 'opt_in' | 'opt_out'
  description?: string | null
  visibility?: 'public' | 'private'
}

export interface UpdateTopicParams {
  name?: string
  description?: string | null
  visibility?: 'public' | 'private'
}

/* ---------------------------------------------------------------- Domínios */

export type DomainStatus =
  | 'not_started'
  | 'pending'
  | 'verified'
  | 'partially_verified'
  | 'partially_failed'
  | 'failed'

export interface DomainRecord {
  record: string
  name: string
  type: string
  ttl: string
  status: string
  value: string
  priority?: number
  diagnostic: string | null
  last_checked_at: string | null
}

export interface Domain {
  object: 'domain'
  id: string
  name: string
  status: DomainStatus
  created_at: string
  region: string
  dns_provider: string | null
  open_tracking: boolean
  click_tracking: boolean
  tracking_subdomain: string | null
  tls: 'opportunistic' | 'enforced'
  capabilities: { sending: 'enabled' | 'disabled'; receiving: 'enabled' | 'disabled' }
  /** Só em `domains.get` e `domains.create`. */
  records?: DomainRecord[]
}

export interface CreateDomainParams {
  name: string
  region?: string
  custom_return_path?: string
  open_tracking?: boolean
  click_tracking?: boolean
  tracking_subdomain?: string
  tls?: 'opportunistic' | 'enforced'
  capabilities?: { sending?: 'enabled' | 'disabled'; receiving?: 'enabled' | 'disabled' }
}

export interface ListDomainsParams extends ListParams {
  search?: string
  status?: DomainStatus | DomainStatus[]
  region?: string
}

/* ---------------------------------------------------------------- Webhooks */

export interface Webhook {
  object: 'webhook'
  id: string
  endpoint: string
  events: string[]
  status: 'enabled' | 'disabled'
  created_at: string
  /** Só em `webhooks.get`, `webhooks.create` e `webhooks.rotateSecret`. */
  signing_secret?: string
}

export interface CreateWebhookParams {
  /** URL HTTPS pública. */
  endpoint: string
  /** Tipos de evento, como `email.delivered`. */
  events: string[]
}

export interface UpdateWebhookParams {
  endpoint?: string
  events?: string[]
  status?: 'enabled' | 'disabled'
}

/** Evento entregue a um endpoint de webhook, já verificado por `verifyWebhook`. */
export interface WebhookEvent<T = Record<string, Json>> {
  type: string
  created_at: string
  data: T
}

/* ------------------------------------------------------------------- Uso */

export interface Usage {
  object: 'usage'
  plan: { id: string; name: string; marketing_id: string | null; marketing_name: string | null }
  emails: {
    daily: { used: number; limit: number | null; resets_at: string }
    monthly: { used: number; limit: number | null; resets_at: string }
  }
  sending: { paused: boolean; paused_at: string | null; reason: string | null }
  rate_limit: { limit: number; duration: string }
  [key: string]: unknown
}
