/**
 * Postal API types. Field names are the same as the API's (snake_case),
 * so the documentation at https://postal.so/en/docs applies directly to the SDK.
 */

export interface ListParams {
  /** Items per page, from 1 to 100. Default: 20. */
  limit?: number
  /** ID of the last item received: returns the items older than it. */
  after?: string
  /** ID of the first item received: returns the items newer than it. */
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

/* ----------------------------------------------------------------- Emails */

export interface EmailTag {
  /** ASCII letters, numbers, `_` or `-`. Cannot start with `postal_`. */
  name: string
  value?: string
}

export interface EmailAttachment {
  /** File content in Base64. Required without `path`. */
  content?: string
  /** Public URL Postal downloads the file from. Required without `content`. */
  path?: string
  filename?: string
  content_type?: string
  /** For inline images: `<img src="cid:logo">` and `content_id: "logo"`. */
  content_id?: string
}

export interface EmailTemplateRef {
  /** ID or alias of the published template. */
  id: string
  variables?: Record<string, string | number | boolean>
}

interface EmailCommon {
  to: string | string[]
  cc?: string | string[]
  bcc?: string | string[]
  reply_to?: string | string[]
  /**
   * Extra headers, sent as they are (the SDK neither encodes nor changes the values). For `OTP-Token`, use
   * `otpTokenHeader(code, origin)`.
   */
  headers?: Record<string, string>
  tags?: EmailTag[]
}

/** Email with its own content. Needs `html` or `text`. */
export interface ContentEmailParams extends EmailCommon {
  /** `email@domain.com` or `Name <email@domain.com>`. The domain must be verified. */
  from: string
  subject: string
  html?: string
  text?: string
  template?: undefined
  attachments?: EmailAttachment[]
  /** Send date (ISO 8601 or `Date`), in the future and at most 30 days ahead. */
  scheduled_at?: string | Date
}

/** Email with a published template. `from`, `subject` and `reply_to` come from the template if not sent. */
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

/** Item of `emails.batch`: like `SendEmailParams`, without attachments or scheduling. */
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
  /** Only in `emails.get`. */
  events?: EmailEvent[]
  domain_id?: string
  api_key_id?: string | null
  template_id?: string | null
  source?: 'api' | 'smtp'
  log_id?: string | null
}

export interface ListEmailsParams extends ListParams {
  search?: string
  /** One or more statuses. */
  status?: EmailStatus | EmailStatus[]
  domain_id?: string
  api_key_id?: string
  start_date?: string
  end_date?: string
}

/* --------------------------------------------------------------- Contacts */

export interface ContactTopicChoice {
  id: string
  subscription: 'opt_in' | 'opt_out'
}

export interface Contact {
  object: 'contact'
  id: string
  email: string
  external_id: string | null
  /** Alias of `external_id`. */
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
  /** The person's ID in your system. Unique per account. */
  external_id?: string | null
  first_name?: string | null
  last_name?: string | null
  unsubscribed?: boolean
  /** Values of the contact properties; each key must exist beforehand. */
  properties?: Record<string, Json>
  /** IDs of static segments. */
  segments?: string[]
  topics?: ContactTopicChoice[]
  /** IDs or names of tags (new names are created). */
  tags?: string[]
}

export interface UpdateContactParams {
  email?: string
  external_id?: string | null
  first_name?: string | null
  last_name?: string | null
  unsubscribed?: boolean
  /** Only the keys sent change; `null` or `""` deletes the value. */
  properties?: Record<string, Json>
  /** Replaces the contact's tags. */
  tags?: string[]
}

export interface UpsertContactParams {
  /** Looks the contact up first by `id`, then by `external_id`, then by `email`. */
  id?: string
  external_id?: string
  /** Required to create a new contact. */
  email?: string
  first_name?: string | null
  last_name?: string | null
  unsubscribed?: boolean
  /** To resubscribe someone who already unsubscribed: when and how the person consented. */
  resubscribe?: { consented_at: string; proof: string }
  properties?: Record<string, Json>
  /** Tags and segments are only added, never removed. */
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

/* ------------------------------------------------------------------ Events */

export interface SendEventParams {
  /** Letters, numbers, `.`, `_`, `:` and `-`; up to 100 characters. E.g.: `signup`, `order.paid`. */
  name: string
  /**
   * Who did it: email, contact ID, `external_id:<id>` or an object.
   * An unknown email creates the contact.
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
  /** The person's ID in your system (alternative to `contact`). */
  external_id?: string
  /** Event data (up to 16 KB), available in automations and emails. */
  properties?: Record<string, Json>
  /** Contact properties to update before starting the automations. */
  contact_properties?: Record<string, Json>
  /** ISO 8601 or `Date`. Default: now. */
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
  /** ID or email of the contact. */
  contact?: string
}

export interface EventName {
  name: string
  count: number
  last_seen_at: string
}

/* --------------------------------------------------- Segments and topics */

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
  /** Does not change after creation. */
  default_subscription: 'opt_in' | 'opt_out'
  description?: string | null
  visibility?: 'public' | 'private'
}

export interface UpdateTopicParams {
  name?: string
  description?: string | null
  visibility?: 'public' | 'private'
}

/* ----------------------------------------------------------------- Domains */

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
  /** Only in `domains.get` and `domains.create`. */
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
  /** Only in `webhooks.get`, `webhooks.create` and `webhooks.rotateSecret`. */
  signing_secret?: string
}

export interface CreateWebhookParams {
  /** Public HTTPS URL. */
  endpoint: string
  /** Event types, such as `email.delivered`. */
  events: string[]
}

export interface UpdateWebhookParams {
  endpoint?: string
  events?: string[]
  status?: 'enabled' | 'disabled'
}

/** Event delivered to a webhook endpoint, already verified by `verifyWebhook`. */
export interface WebhookEvent<T = Record<string, Json>> {
  type: string
  created_at: string
  data: T
}

/* ----------------------------------------------------------------- Usage */

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
