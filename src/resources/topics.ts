import type { RequestOptions } from '../http.js'
import type {
  CreateTopicParams,
  Deleted,
  List,
  ListParams,
  ObjectRef,
  Topic,
  UpdateTopicParams,
} from '../types.js'
import { paginate, Resource, segment } from './base.js'

export class Topics extends Resource {
  list(params: ListParams = {}, options?: RequestOptions): Promise<List<Topic>> {
    return this.http.get('/topics', params, options)
  }

  iterate(): AsyncGenerator<Topic, void, undefined> {
    return paginate((page) => this.list(page), {})
  }

  create(params: CreateTopicParams, options?: RequestOptions): Promise<ObjectRef> {
    return this.http.post('/topics', params, { options })
  }

  get(id: string, options?: RequestOptions): Promise<Topic> {
    return this.http.get(`/topics/${segment(id)}`, undefined, options)
  }

  update(id: string, params: UpdateTopicParams, options?: RequestOptions): Promise<ObjectRef> {
    return this.http.patch(`/topics/${segment(id)}`, params, { options })
  }

  delete(id: string, options?: RequestOptions): Promise<Deleted> {
    return this.http.delete(`/topics/${segment(id)}`, options)
  }
}
