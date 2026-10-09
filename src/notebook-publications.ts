import type { Client, NotebookInstance } from './index.js';
import type { GitSyncAuthor } from './git.js';
import { RemoteError } from './errors/index.js';
import { PublicationInstance, PublicationRun } from './publications.js';
import type {
  LaravelCloudCatalog,
  PlannedPublishInput,
  PublicationData,
  PublicationPlan,
  PublicationPlanInput,
  PublicationProviderName,
  PublicationReadiness,
  PublishInput
} from './publication-types.js';

/** Notebook-scoped planning, source preparation, and publication execution. */
export class NotebookPublications {
  public constructor(
    private readonly notebook: Pick<
      NotebookInstance,
      'data' | 'git' | 'publication' | 'planPublication' | 'preparePublicationSource' | 'publish'
    >,
    private readonly client: Client
  ) {}

  private get path(): string {
    return `/notebook/${encodeURIComponent(this.notebook.data.id)}`;
  }

  public async current(): Promise<PublicationInstance | null> {
    try {
      const response = await this.client.get<PublicationData>(`${this.path}/publication`);
      return new PublicationInstance(response.data, this.client, this.notebook.data.id);
    } catch (error) {
      if (RemoteError.is(error) && error.status === 404) {
        return null;
      }
      throw error;
    }
  }

  public async prepareSource(author: GitSyncAuthor): Promise<string> {
    const targets = await this.notebook.git.targets.list();
    const target = targets.find((item) => item.data.default);
    if (!target) {
      throw new Error('Connect Git Sync before publishing from a repository.');
    }
    const status = await this.notebook.git.status();
    if (status.branch && status.branch !== target.data.branch) {
      throw new Error(`Switch to ${target.data.branch} before publishing, or update the Git Sync branch.`);
    }
    const checkpoint =
      status.clean && status.ref
        ? { ref: status.ref }
        : await this.notebook.git.checkpoint(
            `${author.name} <${author.email}>`,
            'Prepare publication',
            target.data.branch,
            false
          );
    const synced = await target.sync({ direction: 'push', author });
    if (synced.data.lastCommitSha !== checkpoint.ref) {
      throw new Error(
        'The latest changes have not reached the repository yet. Resolve the sync issue before publishing.'
      );
    }
    return checkpoint.ref;
  }

  public async publishPlanned(
    input: PlannedPublishInput,
    options: { author?: GitSyncAuthor } = {}
  ): Promise<PublicationRun> {
    const plan = await this.notebook.planPublication(input);
    if (!plan.ready) {
      throw new Error(plan.blockers.map((blocker) => blocker.message).join(' '));
    }
    const existing = await this.notebook.publication();
    if (existing) {
      throw new Error(
        'This notebook already has a publication. Configure it explicitly, prepare its source, and use publication.publish() to publish changes.'
      );
    }
    if (plan.source.commitAndPush) {
      if (!options.author) {
        throw new Error('A commit author is required to prepare the publication source.');
      }
      await this.notebook.preparePublicationSource(options.author);
    }
    const { requirements: _requirements, resources: _resources, ...publishInput } = input;
    // Execution consumes the provider configuration resolved by Core, for every provider.
    const resolved: PublishInput = {
      ...publishInput,
      provider: { ...input.provider, ...plan.input.provider } as PublishInput['provider']
    };
    return this.notebook.publish(resolved);
  }

  public async readiness(): Promise<PublicationReadiness> {
    return (await this.client.get<PublicationReadiness>(`${this.path}/publication/readiness`)).data;
  }

  public async plan<TName extends PublicationProviderName>(
    input: PublicationPlanInput<TName>
  ): Promise<PublicationPlan<TName>> {
    return (await this.client.post<PublicationPlan<TName>>(`${this.path}/publication/plan`, input)).data;
  }

  public async laravelCloudCatalog(): Promise<LaravelCloudCatalog> {
    return (await this.client.get<LaravelCloudCatalog>(`${this.path}/laravel-cloud/catalog`)).data;
  }

  public async publish(input?: PublishInput): Promise<PublicationRun> {
    const response = await this.client.post<PublicationData>(`${this.path}/publication`, input);
    const run = new PublicationRun(
      new PublicationInstance(response.data, this.client, this.notebook.data.id),
      this.client
    );
    run.start();
    return run;
  }
}
