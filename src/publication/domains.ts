import type { Client } from '../index.js';
import type { PublicationDomainData } from './types.js';

export class PublicationDomains {
  public constructor(
    private readonly client: Client,
    private readonly publicationId: string
  ) {}

  public async list(): Promise<PublicationDomainData[]> {
    return (await this.client.get<PublicationDomainData[]>(this.path())).data;
  }

  public async create(hostname: string): Promise<PublicationDomainData> {
    return (await this.client.post<PublicationDomainData>(this.path(), { hostname })).data;
  }

  public async refresh(id: string): Promise<PublicationDomainData> {
    return (await this.client.post<PublicationDomainData>(`${this.path()}/${encodeURIComponent(id)}/refresh`)).data;
  }

  /** Sets production APP_URL. Publish again to apply it to the running app. */
  public async useAsApplicationUrl(id: string): Promise<{ url: string; requiresPublication: boolean }> {
    return (
      await this.client.post<{ url: string; requiresPublication: boolean }>(
        `${this.path()}/${encodeURIComponent(id)}/application-url`
      )
    ).data;
  }

  public async delete(id: string): Promise<void> {
    await this.client.delete<{ deleted: boolean }>(`${this.path()}/${encodeURIComponent(id)}`);
  }

  private path(): string {
    return `/publications/${encodeURIComponent(this.publicationId)}/domains`;
  }
}
