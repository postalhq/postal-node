import type { RequestOptions } from '../http.js'
import type {
  CreateSegmentParams,
  Deleted,
  List,
  ListSegmentsParams,
  ObjectRef,
  Segment,
  UpdateSegmentParams,
} from '../types.js'
import { paginate, Resource, segment } from './base.js'

export class Segments extends Resource {
  list(params: ListSegmentsParams = {}, options?: RequestOptions): Promise<List<Segment>> {
    return this.http.get('/segments', params, options)
  }

  iterate(params: Omit<ListSegmentsParams, 'limit'> = {}): AsyncGenerator<Segment, void, undefined> {
    return paginate((page) => this.list(page), params)
  }

  create(params: CreateSegmentParams, options?: RequestOptions): Promise<ObjectRef> {
    return this.http.post('/segments', params, { options })
  }

  get(id: string, options?: RequestOptions): Promise<Segment> {
    return this.http.get(`/segments/${segment(id)}`, undefined, options)
  }

  update(id: string, params: UpdateSegmentParams, options?: RequestOptions): Promise<ObjectRef> {
    return this.http.patch(`/segments/${segment(id)}`, params, { options })
  }

  /** Deletes only the list: the contacts stay in the audience. */
  delete(id: string, options?: RequestOptions): Promise<Deleted> {
    return this.http.delete(`/segments/${segment(id)}`, options)
  }
}
