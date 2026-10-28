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
 * Registration of webhook endpoints. To verify the signature of a delivery, use `verifyWebhook`.
 */
export class Webhooks extends Resource {
  list(params: ListParams = {}, options?: RequestOptions): Promise<List<Webhook>> {
    return this.http.get('/webhooks', params, options)
  }

  /** Returns the `signing_secret` (`whsec_...`) used by `verifyWebhook`. */
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

  /** Generates a new secret, valid right away. Update your server afterwards. */
  rotateSecret(id: string, options?: RequestOptions): Promise<Webhook> {
    return this.http.post(`/webhooks/${segment(id)}/signing-secret/rotate`, undefined, { options })
  }
}
