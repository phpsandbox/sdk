import { z } from 'zod';
import type {
  GitHubSmokeEnvironment,
  PublicationSmokeProvider,
  SmokeResourceRegistryEnvironment,
} from './environment.js';

const leaseDirectory = '.sdk-smoke/resource-leases';

const PublicationResourceLeaseSchema = z.object({
  createdAt: z.iso.datetime(),
  notebookId: z.string().min(1),
  provider: z.enum(['cloudflare-containers', 'laravel-cloud', 'ssh-server']),
  runAttempt: z.string().regex(/^\d+$/),
  runId: z.string().regex(/^[A-Za-z0-9_-]+$/),
  server: z.object({
    id: z.string().min(1).optional(),
    name: z.string().min(1),
  }).optional(),
  version: z.literal(1),
});

export type PublicationResourceLease = z.infer<typeof PublicationResourceLeaseSchema>;

interface GitHubContent {
  readonly content: string;
  readonly encoding: 'base64';
  readonly path: string;
  readonly sha: string;
  readonly type: 'file';
}

interface GitHubContentSummary {
  readonly path: string;
  readonly sha: string;
  readonly type: 'dir' | 'file' | 'submodule' | 'symlink';
}

export interface StoredPublicationResourceLease {
  readonly lease: PublicationResourceLease;
  readonly path: string;
  readonly sha: string;
}

export class PublicationResourceLeaseRegistry {
  readonly #apiBaseUrl: URL;

  public constructor(
    private readonly github: GitHubSmokeEnvironment,
    private readonly registry: SmokeResourceRegistryEnvironment,
    private readonly fetchImplementation: typeof globalThis.fetch = globalThis.fetch,
  ) {
    this.#apiBaseUrl = new URL(`https://api.github.com/repos/${registry.repository}/contents/`);
  }

  public async create(lease: PublicationResourceLease): Promise<StoredPublicationResourceLease> {
    const path = resourceLeasePath(lease);
    const sha = await this.#write(path, lease, undefined);
    return { lease, path, sha };
  }

  public async update(
    stored: StoredPublicationResourceLease,
    lease: PublicationResourceLease,
  ): Promise<StoredPublicationResourceLease> {
    const sha = await this.#write(stored.path, lease, stored.sha);
    return { lease, path: stored.path, sha };
  }

  public async delete(stored: Pick<StoredPublicationResourceLease, 'path' | 'sha'>): Promise<void> {
    await this.#request(stored.path, {
      body: JSON.stringify({
        branch: this.registry.branch,
        message: `Release SDK smoke resources ${stored.path.split('/').at(-1) ?? stored.path}`,
        sha: stored.sha,
      }),
      method: 'DELETE',
    });
  }

  public async list(provider: PublicationSmokeProvider): Promise<StoredPublicationResourceLease[]> {
    const response = await this.#request(`${leaseDirectory}/${provider}`, { method: 'GET' }, true);
    if (response === null) {
      return [];
    }

    const summaries = await response.json() as GitHubContentSummary[];
    const files = summaries.filter((item) => item.type === 'file' && item.path.endsWith('.json'));
    const leases: StoredPublicationResourceLease[] = [];
    for (const file of files) {
      const contentResponse = await this.#request(file.path, { method: 'GET' });
      const content = await contentResponse.json() as GitHubContent;
      const decoded = Buffer.from(content.content.replaceAll('\n', ''), content.encoding).toString('utf8');
      leases.push({
        lease: PublicationResourceLeaseSchema.parse(JSON.parse(decoded)),
        path: content.path,
        sha: content.sha,
      });
    }

    return leases;
  }

  async #write(path: string, lease: PublicationResourceLease, sha: string | undefined): Promise<string> {
    const response = await this.#request(path, {
      body: JSON.stringify({
        branch: this.registry.branch,
        content: Buffer.from(`${JSON.stringify(lease, null, 2)}\n`).toString('base64'),
        message: `${sha === undefined ? 'Reserve' : 'Update'} SDK smoke resources ${lease.runId}.${lease.runAttempt}`,
        ...(sha === undefined ? {} : { sha }),
      }),
      method: 'PUT',
    });
    const payload = await response.json() as { readonly content: { readonly sha: string } };
    return payload.content.sha;
  }

  #request(path: string, init: RequestInit): Promise<Response>;
  #request(path: string, init: RequestInit, allowNotFound: true): Promise<Response | null>;
  async #request(path: string, init: RequestInit, allowNotFound = false): Promise<Response | null> {
    const url = new URL(path.replace(/^\//, ''), this.#apiBaseUrl);
    if (init.method === 'GET') {
      url.searchParams.set('ref', this.registry.branch);
    }
    const response = await this.fetchImplementation(url, {
      ...init,
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${this.github.token}`,
        'Content-Type': 'application/json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });
    if (allowNotFound && response.status === 404) {
      return null;
    }
    if (!response.ok) {
      throw new Error(`GitHub resource registry ${init.method} ${path} returned ${response.status}: ${(await response.text()).slice(0, 500)}`);
    }

    return response;
  }
}

export function createPublicationResourceLease(input: {
  readonly notebookId: string;
  readonly provider: PublicationSmokeProvider;
  readonly runAttempt: string;
  readonly runId: string;
  readonly serverName?: string;
  readonly timestamp?: Date;
}): PublicationResourceLease {
  return {
    createdAt: (input.timestamp ?? new Date()).toISOString(),
    notebookId: input.notebookId,
    provider: input.provider,
    runAttempt: input.runAttempt,
    runId: input.runId,
    ...(input.serverName === undefined ? {} : { server: { name: input.serverName } }),
    version: 1,
  };
}

export function isExpiredResourceLease(
  lease: PublicationResourceLease,
  maxAgeHours: number,
  now = new Date(),
): boolean {
  return Date.parse(lease.createdAt) <= now.getTime() - maxAgeHours * 60 * 60 * 1_000;
}

function resourceLeasePath(lease: PublicationResourceLease): string {
  return `${leaseDirectory}/${lease.provider}/${lease.runId}.${lease.runAttempt}.json`;
}
