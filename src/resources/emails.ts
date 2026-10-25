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
   * Envia um e-mail (`POST /emails`).
   *
   * Sem `idempotencyKey`, o SDK gera uma chave para esta chamada e a reaproveita nas
   * retentativas, então uma repetição após timeout ou erro 5xx não duplica o envio.
   */
  send(params: SendEmailParams, options?: RequestOptions): Promise<SendEmailResponse> {
    return this.http.post('/emails', withDates(params), { options, autoIdempotency: true })
  }

  /**
   * Envia até 100 e-mails numa requisição (`POST /emails/batch`). Ou todos entram na fila, ou nenhum.
   */
  batch(emails: BatchEmailItem[], options?: RequestOptions): Promise<BatchEmailResponse> {
    return this.http.post('/emails/batch', emails, { options, autoIdempotency: true })
  }

  /** Um e-mail com o conteúdo e o histórico de eventos (`GET /emails/{id}`). */
  get(id: string, options?: RequestOptions): Promise<Email> {
    return this.http.get(`/emails/${segment(id)}`, undefined, options)
  }

  /** Uma página de e-mails, do mais recente para o mais antigo (`GET /emails`). Exige chave de acesso total. */
  list(params: ListEmailsParams = {}, options?: RequestOptions): Promise<List<Email>> {
    return this.http.get('/emails', params, options)
  }

  /** Percorre todos os e-mails que batem com o filtro, página a página. */
  iterate(params: Omit<ListEmailsParams, 'limit'> = {}): AsyncGenerator<Email, void, undefined> {
    return paginate((page) => this.list(page), params)
  }

  /** Muda a data de um e-mail agendado (`PATCH /emails/{id}`). */
  update(id: string, params: { scheduled_at: string | Date }, options?: RequestOptions): Promise<ObjectRef> {
    return this.http.patch(
      `/emails/${segment(id)}`,
      { scheduled_at: isoDate(params.scheduled_at) },
      { options },
    )
  }

  /** Cancela um e-mail agendado (`POST /emails/{id}/cancel`). */
  cancel(id: string, options?: RequestOptions): Promise<ObjectRef> {
    return this.http.post(`/emails/${segment(id)}/cancel`, undefined, { options })
  }

  /** A mensagem como foi enviada, em formato RFC 5322 (`GET /emails/{id}/raw`). */
  raw(id: string, options?: RequestOptions): Promise<string> {
    return this.http.getText(`/emails/${segment(id)}/raw`, options)
  }
}

function withDates(params: SendEmailParams): Record<string, unknown> {
  return params.scheduled_at === undefined ? { ...params } : { ...params, scheduled_at: isoDate(params.scheduled_at) }
}
