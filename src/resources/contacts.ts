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
 * Onde a documentação diz "ID do contato", vale também o e-mail ou `external_id:<id>`.
 */
export class Contacts extends Resource {
  /** Cria um contato (`POST /contacts`). Falha se o e-mail ou o `external_id` já existirem. */
  create(params: CreateContactParams, options?: RequestOptions): Promise<ObjectRef> {
    return this.http.post('/contacts', params, { options })
  }

  /**
   * Cria ou atualiza um contato, procurando por `id`, depois `external_id`, depois `email`
   * (`POST /contacts/batch` com um item). Repetir a chamada é seguro.
   *
   * @example
   * await postal.contacts.upsert({ external_id: 'user_42', email: 'fulano@exemplo.com', first_name: 'Fulano' })
   */
  async upsert(params: UpsertContactParams, options?: RequestOptions): Promise<UpsertContactResult> {
    const response = await this.http.post<ContactBatchResponse>(
      '/contacts/batch',
      { contacts: [params] },
      { options, idempotent: true },
    )
    const result = response.results?.[0]

    if (result === undefined) {
      throw new PostalError(502, 'invalid_response', 'O Postal não devolveu o resultado do contato.')
    }

    if (result.status === 'failed') {
      throw new PostalError(422, 'validation_error', result.error ?? 'Não foi possível salvar o contato.')
    }

    return result as UpsertContactResult
  }

  /**
   * Cria ou atualiza vários contatos de uma vez (`POST /contacts/batch`). Até 1.000 itens a resposta traz
   * um resultado por item (um item com erro não derruba os outros); acima disso o lote vai para a fila.
   */
  batch(contacts: UpsertContactParams[], options?: RequestOptions): Promise<ContactBatchResponse> {
    return this.http.post('/contacts/batch', { contacts }, { options, idempotent: true })
  }

  /** Um contato pelo ID, e-mail ou `external_id:<id>` (`GET /contacts/{id}`). */
  get(idOrEmail: string, options?: RequestOptions): Promise<Contact> {
    return this.http.get(`/contacts/${segment(idOrEmail)}`, undefined, options)
  }

  /** Um contato pelo `external_id` (a ID dele no seu sistema). */
  getByExternalId(externalId: string, options?: RequestOptions): Promise<Contact> {
    return this.get(`external_id:${externalId}`, options)
  }

  /** Atualiza só os campos enviados (`PATCH /contacts/{id}`). */
  update(idOrEmail: string, params: UpdateContactParams, options?: RequestOptions): Promise<ObjectRef> {
    return this.http.patch(`/contacts/${segment(idOrEmail)}`, params, { options })
  }

  /** Remove o contato da audiência (`DELETE /contacts/{id}`). Para só parar de enviar, use `unsubscribed: true`. */
  delete(idOrEmail: string, options?: RequestOptions): Promise<Deleted> {
    return this.http.delete(`/contacts/${segment(idOrEmail)}`, options)
  }

  /** Uma página de contatos, do mais recente para o mais antigo (`GET /contacts`). */
  list(params: ListContactsParams = {}, options?: RequestOptions): Promise<List<Contact>> {
    return this.http.get('/contacts', params, options)
  }

  /** Percorre todos os contatos que batem com o filtro, página a página. */
  iterate(params: Omit<ListContactsParams, 'limit'> = {}): AsyncGenerator<Contact, void, undefined> {
    return paginate((page) => this.list(page), params)
  }

  /** Coloca o contato num segmento estático (`POST /contacts/{id}/segments/{segment_id}`). */
  addToSegment(idOrEmail: string, segmentId: string, options?: RequestOptions): Promise<unknown> {
    return this.http.post(`/contacts/${segment(idOrEmail)}/segments/${segment(segmentId)}`, undefined, { options })
  }

  /** Tira o contato de um segmento estático (`DELETE /contacts/{id}/segments/{segment_id}`). */
  removeFromSegment(idOrEmail: string, segmentId: string, options?: RequestOptions): Promise<unknown> {
    return this.http.delete(`/contacts/${segment(idOrEmail)}/segments/${segment(segmentId)}`, options)
  }

  /** Registra a escolha do contato em tópicos (`PATCH /contacts/{id}/topics`). */
  updateTopics(idOrEmail: string, topics: ContactTopicChoice[], options?: RequestOptions): Promise<ObjectRef> {
    return this.http.patch(`/contacts/${segment(idOrEmail)}/topics`, { topics }, { options })
  }
}
