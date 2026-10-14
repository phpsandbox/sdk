import type { Client } from '../index.js';
import { RemoteError } from '../errors/index.js';
import { PublicationInstance } from './instance.js';
import { PublicationRun } from './run.js';
import { PublicationResources } from './resources.js';
import type {
  PublicationProjectConfiguration,
  PublicationConfigurationUpdate,
  PublicationApplicationPlan,
  PublicationApplicationPlanInput,
  PublicationApplicationPublishInput,
  PublicationApplicationData,
  PublicationData,
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

  /** Inspect saved configuration and the actual inventory, including removed and legacy apps. */
  public async configuration(): Promise<PublicationProjectConfiguration> {
    return (await this.client.get<PublicationProjectConfiguration>(`${this.path}/publication/configuration`)).data;
  }

  /** Explicit operations preserve omitted apps. Removals never stop deployments or delete resource data. */
  public async updateConfiguration(input: PublicationConfigurationUpdate): Promise<PublicationProjectConfiguration> {
    return (await this.client.patch<PublicationProjectConfiguration>(`${this.path}/publication/configuration`, input)).data;
  }

  /** Review all or selected configured apps at an exact saved revision. */
  public async prepare(input: PublicationApplicationPlanInput): Promise<PublicationApplicationPlan> {
    return (await this.client.post<PublicationApplicationPlan>(`${this.path}/publication/plan`, input)).data;
  }

  /** Publish the exact app selection in a server-owned review. */
  public async publish(input: PublicationApplicationPublishInput): Promise<PublicationApplicationData> {
    const application = (await this.client.post<PublicationApplicationData>(`${this.path}/publication`, input)).data;
    this.startApplicationRuns(application);
    return application;
  }

  public async application(applicationId: string): Promise<PublicationApplicationData> {
    return (await this.client.get<PublicationApplicationData>(`${this.path}/publication/application/${encodeURIComponent(applicationId)}`)).data;
  }

  /** Retry failed apps and pending route attachments while preserving running releases. */
  public async retryApplication(applicationId: string): Promise<PublicationApplicationData> {
    const application = (await this.client.post<PublicationApplicationData>(
      `${this.path}/publication/application/${encodeURIComponent(applicationId)}/retry`,
      {}
    )).data;
    this.startApplicationRuns(application);
    return application;
  }

  public async destroyApplication(applicationId: string, options: { deleteResources?: boolean } = {}): Promise<void> {
    const query = options.deleteResources ? '?deleteResources=1' : '';
    await this.client.delete(`${this.path}/publication/application/${encodeURIComponent(applicationId)}${query}`);
  }

  private startApplicationRuns(application: PublicationApplicationData): void {
    for (const app of application.apps) {
      if (!(application.selectedAppIds ?? []).includes(app.appId)) continue;
      if (!['pending', 'queued', 'building', 'deploying'].includes(app.publication.status)) continue;
      new PublicationRun(
        new PublicationInstance(app.publication, this.client, this.notebookId),
        this.client
      ).start();
    }
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

}
