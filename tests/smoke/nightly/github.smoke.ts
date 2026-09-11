import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import {
  hasGitHubSmokeEnvironment,
  readGitHubSmokeEnvironment,
  type GitHubSmokeEnvironment,
} from '../support/environment.js';
import type { SandboxFixture } from '../support/resources.js';
import { createSandboxFixture, operation } from '../support/resources.js';

const repositoryPrefix = 'phpsandbox-sdk-provider-smoke-';
const repositoryMaximumAgeMs = 6 * 60 * 60 * 1_000;
const markerPath = '.phpsandbox-sdk-provider-smoke.txt';
const author = {
  email: 'sdk-smoke@phpsandbox.io',
  name: 'PHPSandbox SDK Smoke',
} as const;
const gitAuthor = `${author.name} <${author.email}>`;
const isConfigured = hasGitHubSmokeEnvironment();

describe.runIf(isConfigured).sequential('production GitHub provider sync contract', () => {
  let fixture: SandboxFixture | undefined;
  let githubEnvironment: GitHubSmokeEnvironment | undefined;
  let github: GitHubSmokeClient | undefined;

  beforeAll(async () => {
    githubEnvironment = readGitHubSmokeEnvironment();
    github = new GitHubSmokeClient(githubEnvironment);
    await operation('reap stale GitHub smoke repositories', () => (
      github!.deleteStaleRepositories(repositoryPrefix, repositoryMaximumAgeMs)
    ));
    fixture = await createSandboxFixture('github-provider');
  });

  afterAll(async () => {
    await fixture?.resources.cleanup();
  });

  test('pushes, pulls, reconciles, and rolls back a provider conflict', async () => {
    const repository = repositoryName(fixture!);
    const repositoryPath = `${githubEnvironment!.owner}/${repository}`;
    const repositoryCleanup = fixture!.resources.register(`GitHub repository ${repositoryPath}`, () => (
      github!.deleteRepository(repository)
    ));

    const existingIntegration = (await operation('list GitHub integrations', () => fixture!.client.integrations.list()))
      .find(({ provider }) => provider === 'github');
    const integration = existingIntegration
      ? await operation('update GitHub integration', () => existingIntegration.update({
        authorization: { type: 'token', token: githubEnvironment!.token },
      }))
      : await operation('link GitHub integration', () => fixture!.client.integrations.link({
        provider: 'github',
        authorization: { type: 'token', token: githubEnvironment!.token },
      }));
    await operation('attach GitHub integration to sandbox', () => fixture!.sandbox.integrations.attach({
      integration,
    }));
    await operation('initialize provider Git repository', () => fixture!.sandbox.git.checkpoint(
      gitAuthor,
      `Initialize provider smoke ${fixture!.environment.runId}`,
      'main',
      true,
    ));
    await operation('write initial provider marker', () => fixture!.sandbox.files.write(markerPath, 'initial\n'));
    await operation('checkpoint initial provider marker', () => fixture!.sandbox.git.checkpoint(
      gitAuthor,
      `Initial provider marker ${fixture!.environment.runId}`,
      'main',
    ));

    const configuredTarget = await operation('configure GitHub target', () => fixture!.sandbox.git.targets.create({
      author,
      branch: 'main',
      provider: 'github',
      repository: repositoryPath,
      setDefault: true,
    }));
    const firstTarget = await operation('push initial commit to GitHub', () => configuredTarget.sync());
    expect(firstTarget.data).toMatchObject({
      branch: 'main',
      default: true,
      provider: 'github',
      repository: repositoryPath,
    });
    expect(firstTarget.data.lastCommitSha).toMatch(/^[0-9a-f]{40}$/);
    expect(firstTarget.data.lastSyncedAt).toBeTypeOf('string');
    await expect(operation('read initial GitHub marker', () => github!.readFile(repository, markerPath)))
      .resolves.toMatchObject({ content: 'initial\n', commitSha: firstTarget.data.lastCommitSha });

    const targets = await operation('list registered GitHub sync targets', () => fixture!.sandbox.git.targets.list());
    expect(targets.map(({ data }) => data)).toEqual([
      expect.objectContaining({ id: firstTarget.id, repository: repositoryPath }),
    ]);

    const remoteUpdate = await operation('write remote GitHub marker', () => (
      github!.writeFile(repository, markerPath, 'remote\n', `Remote update ${fixture!.environment.runId}`)
    ));
    const pulledTarget = await operation('pull remote GitHub commit', () => firstTarget.sync({
      author,
      direction: 'pull',
    }));
    expect(pulledTarget.id).toBe(firstTarget.id);
    expect(pulledTarget.data.lastCommitSha).toBe(remoteUpdate.commitSha);
    await expect(operation('read pulled provider marker', () => fixture!.sandbox.files.readText(markerPath)))
      .resolves.toBe('remote\n');

    await operation('write local bidirectional marker', () => fixture!.sandbox.files.write(markerPath, 'bidirectional\n'));
    const localCheckpoint = await operation('checkpoint local bidirectional marker', () => fixture!.sandbox.git.checkpoint(
      gitAuthor,
      `Bidirectional update ${fixture!.environment.runId}`,
      'main',
    ));
    const bidirectionalTarget = await operation('sync bidirectional GitHub commit', () => firstTarget.sync({
      author,
      direction: 'both',
    }));
    expect(bidirectionalTarget.data).toMatchObject({ id: firstTarget.id, lastCommitSha: localCheckpoint.ref });
    await expect(operation('read bidirectional GitHub marker', () => github!.readFile(repository, markerPath)))
      .resolves.toMatchObject({ content: 'bidirectional\n', commitSha: localCheckpoint.ref });

    const repeatedTarget = await operation('repeat idempotent GitHub sync', () => firstTarget.sync({
      author,
      direction: 'both',
    }));
    expect(repeatedTarget.id).toBe(firstTarget.id);
    await expect(operation('list idempotent GitHub sync targets', () => fixture!.sandbox.git.targets.list()))
      .resolves.toHaveLength(1);

    await operation('write local conflicting marker', () => fixture!.sandbox.files.write(markerPath, 'local-conflict\n'));
    await operation('checkpoint local conflicting marker', () => fixture!.sandbox.git.checkpoint(
      gitAuthor,
      `Local conflict ${fixture!.environment.runId}`,
      'main',
    ));
    await operation('write remote conflicting marker', () => (
      github!.writeFile(repository, markerPath, 'remote-conflict\n', `Remote conflict ${fixture!.environment.runId}`)
    ));

    await expect(operation('sync conflicting GitHub commits', () => firstTarget.sync({
      author,
      direction: 'both',
    }))).rejects.toThrow(/conflict/i);
    const conflicts = await operation('inspect provider Git conflict', () => fixture!.sandbox.git.conflicts());
    expect(conflicts).toEqual({ conflicts: [], hasConflicts: false });
    await expect(operation('read rolled-back local provider marker', () => fixture!.sandbox.files.readText(markerPath)))
      .resolves.toBe('local-conflict\n');
    await expect(operation('read unchanged remote provider marker', () => github!.readFile(repository, markerPath)))
      .resolves.toMatchObject({ content: 'remote-conflict\n' });

    await operation('align remote provider marker', () => (
      github!.writeFile(repository, markerPath, 'local-conflict\n', `Resolve conflict ${fixture!.environment.runId}`)
    ));
    const resolvedTarget = await operation('retry resolved GitHub sync', () => firstTarget.sync({
      author,
      direction: 'both',
    }));
    await expect(operation('read resolved GitHub marker', () => github!.readFile(repository, markerPath)))
      .resolves.toMatchObject({ content: 'local-conflict\n', commitSha: resolvedTarget.data.lastCommitSha });

    await operation('delete GitHub smoke repository', () => github!.deleteRepository(repository));
    repositoryCleanup.complete();
  }, 300_000);
});

interface GitHubContentResponse {
  readonly content: string;
  readonly encoding: string;
  readonly sha: string;
}

interface GitHubCommitResponse {
  readonly commit: { readonly sha: string };
}

interface GitHubInstallationRepository {
  readonly created_at: string;
  readonly name: string;
  readonly owner: { readonly login: string };
  readonly private: boolean;
}

interface GitHubInstallationRepositoriesResponse {
  readonly repositories: GitHubInstallationRepository[];
  readonly total_count: number;
}

interface GitHubReadFileResult {
  readonly blobSha: string;
  readonly commitSha: string;
  readonly content: string;
}

class GitHubSmokeClient {
  readonly #owner: string;
  readonly #token: string;

  public constructor(environment: GitHubSmokeEnvironment) {
    this.#owner = environment.owner;
    this.#token = environment.token;
  }

  public async readFile(repository: string, path: string): Promise<GitHubReadFileResult> {
    const content = await this.request<GitHubContentResponse>(
      'GET',
      `/repos/${encodeURIComponent(this.#owner)}/${encodeURIComponent(repository)}/contents/${encodePath(path)}?ref=main`,
    );
    if (content.encoding !== 'base64') {
      throw new Error(`GitHub returned unsupported content encoding ${content.encoding}.`);
    }

    const branch = await this.request<{ readonly object: { readonly sha: string } }>(
      'GET',
      `/repos/${encodeURIComponent(this.#owner)}/${encodeURIComponent(repository)}/git/ref/heads/main`,
    );

    return {
      blobSha: content.sha,
      commitSha: branch.object.sha,
      content: Buffer.from(content.content.replaceAll('\n', ''), 'base64').toString('utf8'),
    };
  }

  public async writeFile(
    repository: string,
    path: string,
    content: string,
    message: string,
  ): Promise<{ readonly commitSha: string }> {
    const current = await this.readFile(repository, path);
    const response = await this.request<GitHubCommitResponse>(
      'PUT',
      `/repos/${encodeURIComponent(this.#owner)}/${encodeURIComponent(repository)}/contents/${encodePath(path)}`,
      {
        branch: 'main',
        content: Buffer.from(content).toString('base64'),
        message,
        sha: current.blobSha,
      },
    );

    return { commitSha: response.commit.sha };
  }

  public async deleteRepository(repository: string): Promise<void> {
    await this.request(
      'DELETE',
      `/repos/${encodeURIComponent(this.#owner)}/${encodeURIComponent(repository)}`,
      undefined,
      [404],
    );
  }

  public async deleteStaleRepositories(prefix: string, maximumAgeMs: number): Promise<void> {
    const cutoff = Date.now() - maximumAgeMs;
    let page = 1;

    while (true) {
      const response = await this.request<GitHubInstallationRepositoriesResponse>(
        'GET',
        `/installation/repositories?per_page=100&page=${page}`,
      );

      for (const repository of response.repositories) {
        if (
          repository.owner.login.toLowerCase() === this.#owner.toLowerCase()
          && repository.private
          && repository.name.startsWith(prefix)
          && Date.parse(repository.created_at) < cutoff
        ) {
          await this.deleteRepository(repository.name);
        }
      }

      if (page * 100 >= response.total_count) {
        return;
      }
      page += 1;
    }
  }

  private async request<T = void>(
    method: 'DELETE' | 'GET' | 'PUT',
    path: string,
    body?: Readonly<Record<string, unknown>>,
    acceptedStatuses: readonly number[] = [],
  ): Promise<T> {
    const request: RequestInit = {
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${this.#token}`,
        'Content-Type': 'application/json',
        'User-Agent': 'phpsandbox-sdk-production-smoke',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      method,
    };
    if (body !== undefined) {
      request.body = JSON.stringify(body);
    }
    const response = await fetch(`https://api.github.com${path}`, request);

    if (acceptedStatuses.includes(response.status)) {
      return undefined as T;
    }
    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`GitHub ${method} ${path} failed (${response.status}): ${detail}`);
    }
    if (response.status === 204) {
      return undefined as T;
    }

    return await response.json() as T;
  }
}

function repositoryName(fixture: SandboxFixture): string {
  const suffix = `${fixture.environment.runId}-${fixture.environment.transport}-${fixture.sandbox.data.id}`
    .toLowerCase()
    .replaceAll(/[^a-z0-9-]/g, '-');

  return `${repositoryPrefix}${suffix}`.slice(0, 100);
}

function encodePath(path: string): string {
  return path.split('/').map((segment) => encodeURIComponent(segment)).join('/');
}
