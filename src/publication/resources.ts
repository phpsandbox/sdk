import type { Client, PaginatedApiResponse } from '../index.js';
import type { PublicationManagedResource, PublicationResourceListOptions } from './types.js';

export class PublicationResources {
  public constructor(
    private readonly client: Client,
    private readonly path = '/publication-resources'
  ) {}

  public async list(options: PublicationResourceListOptions = {}): Promise<PaginatedApiResponse<PublicationManagedResource>> {
    const query = new URLSearchParams();
    for (const [name, value] of Object.entries(options)) {
      if (value !== undefined) {
        query.set(name, String(value));
      }
    }
    const suffix = query.size > 0 ? `?${query.toString()}` : '';
    return this.client.get<PublicationManagedResource[]>(`${this.path}${suffix}`);
  }
}
