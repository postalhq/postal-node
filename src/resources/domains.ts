import type { RequestOptions } from '../http.js'
import type { CreateDomainParams, Domain, List, ListDomainsParams, ObjectRef } from '../types.js'
import { paginate, Resource, segment } from './base.js'

export class Domains extends Resource {
  list(params: ListDomainsParams = {}, options?: RequestOptions): Promise<List<Domain>> {
    return this.http.get('/domains', params, options)
  }

  iterate(params: Omit<ListDomainsParams, 'limit'> = {}): AsyncGenerator<Domain, void, undefined> {
    return paginate((page) => this.list(page), params)
  }

  /** The domain with its DNS records and the status of each. */
  get(id: string, options?: RequestOptions): Promise<Domain> {
    return this.http.get(`/domains/${segment(id)}`, undefined, options)
  }

  /** Registers the domain and returns the DNS records to create. Then call `verify`. */
  create(params: CreateDomainParams, options?: RequestOptions): Promise<Domain> {
    return this.http.post('/domains', params, { options })
  }

  /** Asks Postal to check the DNS now (`POST /domains/{id}/verify`). Follow the status with `get`. */
  verify(id: string, options?: RequestOptions): Promise<ObjectRef> {
    return this.http.post(`/domains/${segment(id)}/verify`, undefined, { options })
  }
}
