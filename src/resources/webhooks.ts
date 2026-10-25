import type { RequestOptions } from '../http.js'
import type {
  CreateWebhookParams,
  Deleted,
  List,
  ListParams,
  ObjectRef,
  UpdateWebhookParams,
  Webhook,
} from '../types.js'
import { Resource, segment } from './base.js'

/**
 * Cadastro dos endpoints de webhook. Para conferir a assinatura de uma entrega, use `verifyWebhook`.
 */
export class Webhooks extends Resource {
  list(params: ListParams = {}, options?: RequestOptions): Promise<List<Webhook>> {
    return this.http.get('/webhooks', params, options)
  }

  /** Devolve o `signing_secret` (`whsec_...`) usado por `verifyWebhook`. */
  create(params: CreateWebhookParams, options?: RequestOptions): Promise<Webhook> {
    return this.http.post('/webhooks', params, { options })
  }

  get(id: string, options?: RequestOptions): Promise<Webhook> {
    return this.http.get(`/webhooks/${segment(id)}`, undefined, options)
  }

  update(id: string, params: UpdateWebhookParams, options?: RequestOptions): Promise<ObjectRef> {
    return this.http.patch(`/webhooks/${segment(id)}`, params, { options })
  }

  delete(id: string, options?: RequestOptions): Promise<Deleted> {
    return this.http.delete(`/webhooks/${segment(id)}`, options)
  }

  /** Gera um segredo novo, que vale na hora. Atualize o seu servidor em seguida. */
  rotateSecret(id: string, options?: RequestOptions): Promise<Webhook> {
    return this.http.post(`/webhooks/${segment(id)}/signing-secret/rotate`, undefined, { options })
  }
}
