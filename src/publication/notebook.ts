import type { Client } from '../index.js';
import { RemoteError } from '../errors/index.js';
import { PublicationInstance } from './instance.js';
import { PublicationRun } from './run.js';
import { PublicationResources } from './resources.js';
import type {
  PlannedPublishInput,
  PublicationApplicationPlan,
  PublicationApplicationPlanInput,
  PublicationApplicationPublishInput,
  PublicationApplicationData,
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

  /** Review a multi-component publishing plan without creating resources or starting releases. */
  public async prepareApplication(input: PublicationApplicationPlanInput): Promise<PublicationApplicationPlan> {
    return (await this.client.post<PublicationApplicationPlan>(`${this.path}/publication/application-plan`, input)).data;
  }

  /** Publish every component in a reviewed application plan. */
  public async publishApplication(input: PublicationApplicationPublishInput): Promise<PublicationApplicationData> {
    const application = (await this.client.post<PublicationApplicationData>(`${this.path}/publication/application`, input)).data;
    this.startApplicationRuns(application);
    return application;
  }

  public async application(applicationId: string): Promise<PublicationApplicationData> {
    return (await this.client.get<PublicationApplicationData>(`${this.path}/publication/application/${encodeURIComponent(applicationId)}`)).data;
  }

  /** Retry only failed components while leaving healthy components untouched. */
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
    for (const component of application.components) {
      if (!['pending', 'queued', 'building', 'deploying'].includes(component.publication.status)) continue;
      new PublicationRun(
        new PublicationInstance(component.publication, this.client, this.notebookId),
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

  /** Core validates the plan, prepares source and executes publishing. */
  public async publish(input?: PlannedPublishInput): Promise<PublicationRun> {
    const response = await this.client.post<PublicationData>(`${this.path}/publication`, input);
    return new PublicationRun(new PublicationInstance(response.data, this.client, this.notebookId), this.client).start();
  }
}
