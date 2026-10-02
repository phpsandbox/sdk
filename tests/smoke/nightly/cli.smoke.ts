import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { createCliSmoke, hasCliSmokeBinary, type CliSmoke } from '../support/cli.js';
import { createSandboxFixture, type SandboxFixture } from '../support/resources.js';
import { readGitHubSmokeEnvironment } from '../support/environment.js';

describe.runIf(hasCliSmokeBinary()).sequential('compiled CLI private GitHub workflows', () => {
  let fixture: SandboxFixture | undefined;
  let cli: CliSmoke | undefined;
  let target: string;
  const github = () => readGitHubSmokeEnvironment();
  const repository = `phpsandbox-sdk-provider-smoke-cli-${randomUUID()}`;
  const marker = 'cli-provider.txt';
  const author = { name: 'PHPSandbox CLI Smoke', email: 'cli-smoke@phpsandbox.io' };
  const commitAuthor = `${author.name} <${author.email}>`;
  beforeAll(async () => {
    fixture = await createSandboxFixture('cli-github');
    cli = await createCliSmoke(fixture);
  }, 180000);
  afterAll(async () => {
    await fixture?.resources.cleanup();
  }, 180000);
  function active(): { fixture: SandboxFixture; cli: CliSmoke } {
    if (!fixture || !cli) throw new Error('CLI provider fixture was not initialized.');
    return { fixture, cli };
  }
  async function githubRequest(method: string, path: string, body?: unknown): Promise<unknown> {
    const response = await fetch(`https://api.github.com${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${github().token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (method === 'DELETE' && response.status === 404) return null;
    if (!response.ok) throw new Error(`GitHub smoke ${method} returned ${response.status}.`);
    return response.status === 204 ? null : response.json();
  }
  const repositoryPath = () =>
    `/repos/${encodeURIComponent(github().owner)}/${encodeURIComponent(repository)}`;
  test('links GitHub credentials, attaches them, and configures a sync target', async () => {
    const { fixture, cli } = active();
    const integration = z
      .object({ id: z.string() })
      .parse(
        await cli.run(
          ['integrations', 'link', 'github', '--label', 'CLI GitHub smoke'],
          github().token,
        ),
      );
    fixture.resources.register('CLI GitHub integration', async () => {
      await (await fixture.client.integrations.get(integration.id)).unlink();
    });
    fixture.resources.register('CLI GitHub repository', async () => {
      await githubRequest('DELETE', repositoryPath());
    });
    await cli.run(['integrations', 'sandbox', 'attach', integration.id]);
    await cli.run([
      'git',
      'checkpoint',
      'CLI provider baseline',
      '--author',
      commitAuthor,
      '--allow-empty',
    ]);
    await cli.run(['files', 'write', marker], 'initial\n');
    await cli.run(['git', 'checkpoint', 'CLI initial marker', '--author', commitAuthor]);
    const configured = z.object({ id: z.string() }).parse(
      await cli.run(
        ['git', 'targets', 'create', '-'],
        JSON.stringify({
          provider: 'github',
          repository: `${github().owner}/${repository}`,
          author,
          branch: 'main',
          setDefault: true,
        }),
      ),
    );
    target = configured.id;
  });
  test('pushes a private repository and reports sync metadata', async () => {
    const result = await active().cli.run([
      'git',
      'targets',
      'sync',
      target,
      '--direction',
      'push',
    ]);
    expect(result).toMatchObject({ id: target, provider: 'github' });
    const file = z
      .object({ content: z.string() })
      .parse(await githubRequest('GET', `${repositoryPath()}/contents/${marker}`));
    expect(Buffer.from(file.content, 'base64').toString()).toBe('initial\n');
  });
  test('pulls a remote commit through the CLI', async () => {
    const file = z
      .object({ sha: z.string() })
      .parse(await githubRequest('GET', `${repositoryPath()}/contents/${marker}`));
    await githubRequest('PUT', `${repositoryPath()}/contents/${marker}`, {
      branch: 'main',
      content: Buffer.from('remote\n').toString('base64'),
      message: 'CLI remote update',
      sha: file.sha,
    });
    await active().cli.run(['git', 'targets', 'sync', target, '--direction', 'pull']);
    expect(await active().cli.run(['files', 'read', marker])).toBe('remote\n');
  });
  test('synchronizes local commits bidirectionally', async () => {
    const { cli } = active();
    await cli.run(['files', 'write', marker, '--overwrite'], 'local\n');
    await cli.run(['git', 'checkpoint', 'CLI local update', '--author', commitAuthor]);
    await cli.run(['git', 'targets', 'sync', target, '--direction', 'both']);
    const file = z
      .object({ content: z.string() })
      .parse(await githubRequest('GET', `${repositoryPath()}/contents/${marker}`));
    expect(Buffer.from(file.content, 'base64').toString()).toBe('local\n');
  });
  test('inspects a private repository and discovers its template', async () => {
    const input = {
      provider: 'github',
      repo: `https://github.com/${github().owner}/sdk-smoke-fixtures`,
      branch: 'main',
      auth: { accessToken: github().token },
    };
    expect(
      await active().cli.run(['imports', 'inspect', '-'], JSON.stringify(input)),
    ).toMatchObject({ supported: true, framework: 'laravel' });
  });
  test('imports a private repository with creation-time secrets, executes code, and deletes it', async () => {
    const { cli } = active();
    const config = join(cli.root, 'creation.json');
    await writeFile(
      config,
      JSON.stringify({
        visibility: 'private',
        secrets: [
          {
            name: 'APP_KEY',
            value: 'base64:cGhwc2FuZGJveC1zZGstcHVibGljYXRpb24ta2V5ISE=',
            environment: 'development',
          },
        ],
      }),
      { mode: 0o600 },
    );
    const input = {
      provider: 'github',
      repo: `https://github.com/${github().owner}/sdk-smoke-fixtures`,
      branch: 'main',
      auth: { accessToken: github().token },
    };
    const notebook = z
      .object({ id: z.string() })
      .parse(
        await cli.run(
          [
            'import',
            '-',
            '--template',
            'standard',
            '--name',
            `cli-private-import-${randomUUID()}`,
            '--config',
            config,
          ],
          JSON.stringify(input),
          0,
          300000,
        ),
      );
    const selected = z
      .object({ id: z.string() })
      .parse(await cli.run(['status', '--sandbox', notebook.id]));
    expect(selected.id).toBe(notebook.id);
    expect(
      await cli.run(['exec', '--sandbox', notebook.id, '--', 'php', '-r', 'echo "cli-import";']),
    ).toMatchObject({ exitCode: 0, stdout: 'cli-import' });
    await cli.run(['delete', notebook.id, '--yes']);
  }, 360000);
});
