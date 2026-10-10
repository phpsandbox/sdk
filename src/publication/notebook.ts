import type { Client } from '../index.js';
import { RemoteError } from '../errors/index.js';
import { PublicationInstance } from './instance.js';
import { PublicationRun } from './run.js';
import { PublicationResources } from './resources.js';
import type {
  PlannedPublishInput,
  PublicationData,
  PublicationPlan,
  PublicationPlanInput,
  PublicationProviderName,
  PublicationReadiness,
  PublicationResourceCatalog,
} from './types.js';

export class NotebookPublication {
  public readonly resources: PublicationResources;
  public constructor(
    private readonly notebookId: string,
    private readonly client: Client
  ) {
    this.resources = new PublicationResources(client, `${this.path}/publication/resources`);
  }

  private get path(): string {
    return `/notebook/${encodeURIComponent(this.notebookId)}`;
  }

  public async current(): Promise<PublicationInstance | null> {
    try {
      const response = await this.client.get<PublicationData>(`${this.path}/publication`);
      return new PublicationInstance(response.data, this.client, this.notebookId);
    } catch (error) {
      if (RemoteError.is(error) && error.status === 404) {
        return null;
      }
      throw error;
    }
  }

  public async readiness(): Promise<PublicationReadiness> {
    return (await this.client.get<PublicationReadiness>(`${this.path}/publication/readiness`)).data;
  }

  /** Review a publishing plan without committing changes or creating resources. */
  public async prepare<TName extends PublicationProviderName>(
    input: PublicationPlanInput<TName>
  ): Promise<PublicationPlan<TName>> {
    return (await this.client.post<PublicationPlan<TName>>(`${this.path}/publication/plan`, input)).data;
  }

  public catalog(provider: 'laravel-cloud' | 'cloudflare-containers'): Promise<PublicationResourceCatalog>;
  public catalog(provider: 'ssh-server', serverId: string): Promise<PublicationResourceCatalog>;
  public async catalog(
    provider: PublicationProviderName,
    serverId?: string
  ): Promise<PublicationResourceCatalog> {
    const query = new URLSearchParams({ provider });
    if (serverId !== undefined) {
      query.set('serverId', serverId);
    }
    return (await this.client.get<PublicationResourceCatalog>(`${this.path}/publication/catalog?${query}`))
      .data;
  }

  /** Core validates the plan, prepares source and executes publishing. */
  public async publish(input?: PlannedPublishInput): Promise<PublicationRun> {
    const response = await this.client.post<PublicationData>(`${this.path}/publication`, input);
    return new PublicationRun(new PublicationInstance(response.data, this.client, this.notebookId), this.client).start();
  }
}
