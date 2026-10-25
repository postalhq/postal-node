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

  /** O domínio com os registros DNS e o status de cada um. */
  get(id: string, options?: RequestOptions): Promise<Domain> {
    return this.http.get(`/domains/${segment(id)}`, undefined, options)
  }

  /** Cadastra o domínio e devolve os registros DNS a criar. Depois, chame `verify`. */
  create(params: CreateDomainParams, options?: RequestOptions): Promise<Domain> {
    return this.http.post('/domains', params, { options })
  }

  /** Pede ao Postal que confira o DNS agora (`POST /domains/{id}/verify`). Acompanhe o status com `get`. */
  verify(id: string, options?: RequestOptions): Promise<ObjectRef> {
    return this.http.post(`/domains/${segment(id)}/verify`, undefined, { options })
  }
}
