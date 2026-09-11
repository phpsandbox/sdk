import { execFile } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterAll, describe, expect, test, vi } from 'vitest';
import type {
  CleanupHandle,
  SandboxFixture,
} from '../support/resources.js';
import {
  createSandboxFixture,
  operation,
} from '../support/resources.js';
import {
  createPublicationResourceLease,
  PublicationResourceLeaseRegistry,
  type StoredPublicationResourceLease,
} from '../support/resource-leases.js';
import {
  readPublicationSmokeEnvironment,
  type PublicationSmokeEnvironment,
} from '../support/environment.js';
import type {
  PublicationInstance,
  PublicationProviderInput,
  PublishStreamEvent,
  PublishStreamResult,
  ServerInstance,
} from '@phpsandbox/sdk';

const executeFile = promisify(execFile);
const fixtureMarker = 'phpsandbox-sdk-publication-fixture-v1';
const fixtureApplicationKey = 'base64:cGhwc2FuZGJveC1zZGstcHVibGljYXRpb24ta2V5ISE=';
const publicationTimeoutMs = 15 * 60 * 1_000;
const rookInstallerUrl = 'https://install.phpsandbox.io/agent';

describe.sequential('production publication provider contract', () => {
  let environment: PublicationSmokeEnvironment | undefined;
  let fixture: SandboxFixture | undefined;
  let publication: PublicationInstance | undefined;
  let publicationCleanup: CleanupHandle | undefined;
  let publicationEvents: PublishStreamEvent[] | undefined;
  let publishResult: PublishStreamResult | undefined;
  let publicationPassword: string | undefined;
  let server: ServerInstance | undefined;
  let serverCleanup: CleanupHandle | undefined;
  let rookCleanup: CleanupHandle | undefined;
  let installerPath: string | undefined;
  let resourceLease: StoredPublicationResourceLease | undefined;
  let resourceLeaseRegistry: PublicationResourceLeaseRegistry | undefined;

  afterAll(async () => {
    await fixture?.resources.cleanup();
    if (resourceLease !== undefined) {
      await resourceLeaseRegistry?.delete(resourceLease);
      resourceLease = undefined;
    }
  }, 300_000);

  test('provisions the provider smoke fixture', async () => {
    environment = readPublicationSmokeEnvironment();
    if (environment.provider === 'laravel-cloud') {
      await verifyLaravelCloudCredential(environment);
    }
    fixture = await createSandboxFixture(`publication-${environment.provider}`, {
      import: {
        auth: { accessToken: environment.github.token },
        branch: 'main',
        provider: 'github',
        repo: `https://github.com/${environment.repository}`,
      },
    });
    const serverName = environment.provider === 'ssh-server'
      ? `SDK Rook ${fixture.environment.runId}`
      : undefined;
    resourceLeaseRegistry = new PublicationResourceLeaseRegistry(
      environment.github,
      environment.resourceRegistry,
    );
    resourceLease = await operation('reserve publication smoke resources', () => resourceLeaseRegistry!.create(
      createPublicationResourceLease({
        notebookId: fixture!.sandbox.data.id,
        provider: environment!.provider,
        runAttempt: fixture!.environment.workflowAttempt,
        runId: fixture!.environment.workflowRunId,
        ...(serverName === undefined ? {} : { serverName }),
      }),
    ));
    await operation('store publication application key', () => fixture!.sandbox.secrets.set(
      'APP_KEY',
      {
        environment: 'production',
        type: 'environment_variable',
        value: fixtureApplicationKey,
      },
    ));

    if (environment.provider === 'laravel-cloud') {
      const existingIntegration = (await operation(
        'list Laravel Cloud integrations',
        () => fixture!.client.integrations.list(),
      )).find(({ provider }) => provider === 'laravel-cloud');
      const integration = existingIntegration
        ? await operation('update Laravel Cloud integration', () => existingIntegration.update({
          authorization: { type: 'token', token: environment!.laravelCloudApiKey! },
        }))
        : await operation('link Laravel Cloud integration', () => fixture!.client.integrations.link({
          provider: 'laravel-cloud',
          authorization: { type: 'token', token: environment!.laravelCloudApiKey! },
        }));
      await operation('attach Laravel Cloud integration to sandbox', () => fixture!.sandbox.integrations.attach({
        integration,
      }));
    }

    if (environment.provider === 'cloudflare-containers') {
      const existingIntegration = (await operation(
        'list Cloudflare integrations',
        () => fixture!.client.integrations.list(),
      )).find(({ provider }) => provider === 'cloudflare');
      const integration = existingIntegration
        ? await operation('update Cloudflare integration', () => existingIntegration.update({
          authorization: { type: 'token', token: environment!.cloudflareApiToken! },
        }))
        : await operation('link Cloudflare integration', () => fixture!.client.integrations.link({
          provider: 'cloudflare',
          authorization: { type: 'token', token: environment!.cloudflareApiToken! },
        }));
      await operation('attach Cloudflare integration to sandbox', () => fixture!.sandbox.integrations.attach({
        integration,
      }));
    }

    if (environment.provider === 'ssh-server') {
      server = await operation('create Rook server registration', () => fixture!.client.servers.create({
        host: 'github-actions.local',
        name: serverName!,
        ssh: { port: 22, user: 'runner' },
      }));
      resourceLease = await operation('record Rook server registration', () => resourceLeaseRegistry!.update(
        resourceLease!,
        {
          ...resourceLease!.lease,
          server: { id: server!.data.id, name: serverName! },
        },
      ));
      serverCleanup = fixture.resources.register(`server ${server.data.id}`, () => server!.delete());
      installerPath = await downloadRookInstaller();
      rookCleanup = fixture.resources.register('local Rook installation', () => uninstallRook(installerPath!));

      if (server.data.installCommand === undefined) {
        throw new Error('Created server registration without an install command.');
      }
      await operation(
        'install Rook from generated command',
        () => executeFile('/bin/bash', ['-lc', server!.data.installCommand!], { timeout: 180_000 }).then(() => undefined),
        200_000,
      );
      server = await operation('wait for Rook connection', () => server!.waitReady({
        interval: 1_000,
        timeout: 120_000,
      }), 140_000);
    }
  }, publicationTimeoutMs);

  test('publishes and reaches a healthy state', async () => {
    const activeEnvironment = requireStageValue(environment, 'provider smoke environment');
    const activeFixture = requireStageValue(fixture, 'sandbox fixture');
    const provider = publicationProvider(activeEnvironment, server);
    const slug = publicationSlug(activeFixture, activeEnvironment);
    publicationPassword = `sdk-publication-${activeFixture.environment.runId}`;
    const run = await operation('start publication', () => activeFixture.sandbox.publish({
      protection: { mode: 'none' },
      provider,
      slug,
    }));
    publication = run.initial;
    publicationCleanup = activeFixture.resources.register(`publication ${run.initial.data.id}`, () => (
      run.initial.destroy()
    ));
    const eventsPromise = collectEvents(run.events());
    void eventsPromise.catch(() => undefined);

    publishResult = await operation('wait for publication result', () => run.result(), publicationTimeoutMs);
    publicationEvents = await operation('collect publication stream', () => eventsPromise, publicationTimeoutMs);
    publication = await operation('read completed publication', () => run.publication());

    expect(publishResult).toMatchObject({ status: 'healthy', success: true });
    expect(publishResult.url).toBe(publication.data.url);
    expect(publication.data).toMatchObject({
      id: publishResult.publicationId,
      provider: { name: activeEnvironment.provider },
      status: 'healthy',
    });
    expect(publicationEvents.some((event) => event.type === 'phase' && event.name === 'build.started')).toBe(true);
    expect(publicationEvents.some((event) => event.type === 'phase' && event.name === 'deploy.completed')).toBe(true);
    expect(publicationEvents.some((event) => event.type === 'log' && event.content.trim() !== '')).toBe(true);
    expect(publicationEvents.some((event) => event.type === 'result' && event.url === publication!.data.url)).toBe(true);
  }, publicationTimeoutMs);

  test('exposes the publication through every lookup surface', async () => {
    const activeEnvironment = requireStageValue(environment, 'provider smoke environment');
    const activeFixture = requireStageValue(fixture, 'sandbox fixture');
    const activePublication = requireStageValue(publication, 'healthy publication');
    const current = await operation('read current notebook publication', () => activeFixture.sandbox.publication());
    expect(current?.data.id).toBe(activePublication.data.id);
    const fetched = await operation(
      'get publication by id',
      () => activeFixture.client.publications.get(activePublication.data.id),
    );
    expect(fetched.data.status).toBe('healthy');

    await expectPublishedMarker(activePublication.data.url);
    if (activeEnvironment.provider === 'laravel-cloud') {
      await expectLaravelCloudApplicationCount(activeEnvironment, activePublication.data.slug, 1);
    }
  });

  test('streams historical events and logs', async () => {
    const activePublication = requireStageValue(publication, 'healthy publication');
    const historicEvents = await operation('stream publication events', async () => (
      collectStream(await activePublication.events())
    ));
    const buildLogs = await operation('stream publication build logs', async () => (
      collectStream(await activePublication.buildLogs())
    ));
    const runtimeLogs = await operation('stream publication runtime logs', async () => (
      collectStream(await activePublication.logs())
    ));
    expect(historicEvents.length).toBeGreaterThan(0);
    expect(buildLogs.length).toBeGreaterThan(0);
    expect(runtimeLogs).toBeInstanceOf(Array);
  });

  test('enforces and removes password protection', async () => {
    const activePublication = requireStageValue(publication, 'healthy publication');
    const password = requireStageValue(publicationPassword, 'publication password');
    const protectedPublication = await operation('enable publication protection', () => activePublication.setProtection({
      mode: 'password',
      password,
    }));
    const blocked = await operation('request protected publication without a session', () => fetch(
      markerUrl(protectedPublication.data.url),
      { redirect: 'manual' },
    ));
    expect(blocked.status).toBeGreaterThanOrEqual(300);

    const protection = await operation('read publication protection', () => protectedPublication.protection());
    expect(protection).toMatchObject({ enabled: true, mode: 'password' });
    expect(JSON.stringify(protection)).not.toContain(password);
    const session = await operation('create publication protection session', () => (
      protectedPublication.createProtectionSession()
    ));
    await expectProtectedPublishedMarker(withPath(session.url, '/sdk-smoke'));
    const unprotected = await operation('disable publication protection', () => protectedPublication.disableProtection());
    expect(unprotected.data.protection.enabled).toBe(false);
  });

  test('tears down owned provider resources', async () => {
    const activeEnvironment = requireStageValue(environment, 'provider smoke environment');
    const activePublication = requireStageValue(publication, 'healthy publication');
    await operation('destroy publication', () => activePublication.destroy(), 300_000);
    publicationCleanup?.complete();

    if (activeEnvironment.provider === 'ssh-server') {
      const activeInstallerPath = requireStageValue(installerPath, 'Rook installer');
      const activeServer = requireStageValue(server, 'Rook server');
      await operation('purge local Rook installation', () => uninstallRook(activeInstallerPath), 180_000);
      rookCleanup?.complete();
      await operation('delete Rook server registration', () => activeServer.delete());
      serverCleanup?.complete();
    }
  }, 360_000);

  test('confirms owned resources were removed', async () => {
    const activeEnvironment = requireStageValue(environment, 'provider smoke environment');
    const activeFixture = requireStageValue(fixture, 'sandbox fixture');
    const activePublication = requireStageValue(publication, 'destroyed publication');
    await expect(operation('read destroyed current publication', () => activeFixture.sandbox.publication()))
      .resolves.toBeNull();
    await expectPublicationRouteRemoved(activePublication.data.url);
    if (activeEnvironment.provider === 'laravel-cloud') {
      await expectLaravelCloudApplicationCount(activeEnvironment, activePublication.data.slug, 0);
    }

    if (activeEnvironment.provider === 'ssh-server') {
      const activeServer = requireStageValue(server, 'deleted Rook server');
      await expect(commandSucceeds('sudo', ['systemctl', 'is-active', 'rook'])).resolves.toBe(false);
      await expect(commandSucceeds('id', ['rook'])).resolves.toBe(false);
      await expect(operation('read deleted Rook server', () => activeFixture.client.servers.get(activeServer.data.id)))
        .rejects.toThrow();
    }

    const activeResourceLease = requireStageValue(resourceLease, 'resource lease');
    await operation('release publication smoke resources', () => resourceLeaseRegistry!.delete(activeResourceLease));
    resourceLease = undefined;
  });
});

function requireStageValue<T>(value: T | undefined, name: string): T {
  if (value === undefined) {
    throw new Error(`Publication smoke prerequisite is unavailable: ${name}.`);
  }

  return value;
}

function publicationProvider(
  environment: PublicationSmokeEnvironment,
  server: ServerInstance | undefined,
): PublicationProviderInput {
  switch (environment.provider) {
    case 'cloudflare-containers':
      return {
        name: 'cloudflare-containers',
        accountId: environment.cloudflareAccountId!,
        size: 'nano',
        sleepAfter: '10m',
      };
    case 'laravel-cloud':
      return {
        name: 'laravel-cloud',
        region: 'eu-central-1',
      };
    case 'ssh-server':
      if (server === undefined) {
        throw new Error('SSH publication requires a connected Rook server.');
      }
      return { name: 'ssh-server', serverId: server.data.id };
  }
}

function publicationSlug(fixture: SandboxFixture, environment: PublicationSmokeEnvironment): string {
  const runId = fixture.environment.runId.replaceAll('.', '-');
  return `sdk-${environment.provider.replaceAll(/[^a-z0-9]/g, '-')}-${runId}`.slice(0, 63);
}

async function collectEvents(events: AsyncIterable<PublishStreamEvent>): Promise<PublishStreamEvent[]> {
  const collected: PublishStreamEvent[] = [];
  for await (const event of events) {
    collected.push(event);
  }
  return collected;
}

async function collectStream<T>(stream: ReadableStream<T>): Promise<T[]> {
  const values: T[] = [];
  for await (const value of stream) {
    values.push(value);
  }
  return values;
}

async function expectPublishedMarker(baseUrl: string): Promise<void> {
  await vi.waitFor(async () => {
    const url = baseUrl.includes('/sdk-smoke') ? baseUrl : markerUrl(baseUrl);
    const response = await fetch(url);
    const body = await response.text();
    if (!response.ok || !body.includes(fixtureMarker)) {
      throw new Error(`published marker ${url} returned ${response.status}: ${body.slice(0, 500)}`);
    }
  }, { interval: 2_000, timeout: 120_000 });
}

async function expectProtectedPublishedMarker(sessionUrl: string): Promise<void> {
  await vi.waitFor(async () => {
    const bootstrap = await fetch(sessionUrl, { redirect: 'manual' });
    const location = bootstrap.headers.get('location');
    const cookies = bootstrap.headers.getSetCookie()
      .map((cookie) => cookie.split(';', 1)[0])
      .filter((cookie) => cookie !== undefined);
    if (bootstrap.status !== 303 || location === null || cookies.length === 0) {
      throw new Error(`publication session bootstrap returned ${bootstrap.status}`);
    }

    const response = await fetch(new URL(location, sessionUrl), {
      headers: { Cookie: cookies.join('; ') },
      redirect: 'manual',
    });
    const body = await response.text();
    if (!response.ok || !body.includes(fixtureMarker)) {
      throw new Error(`protected published marker returned ${response.status}: ${body.slice(0, 500)}`);
    }
  }, { interval: 2_000, timeout: 120_000 });
}

async function expectPublicationRouteRemoved(baseUrl: string): Promise<void> {
  await vi.waitFor(async () => {
    const response = await fetch(markerUrl(baseUrl), { redirect: 'manual' });
    expect(response.status).toBeGreaterThanOrEqual(400);
  }, { interval: 2_000, timeout: 120_000 });
}

async function expectLaravelCloudApplicationCount(
  environment: PublicationSmokeEnvironment,
  slug: string,
  expectedCount: number,
): Promise<void> {
  await vi.waitFor(async () => {
    const url = new URL('https://cloud.laravel.com/api/applications');
    url.searchParams.set('filter[slug]', slug);
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${environment.laravelCloudApiKey!}` },
    });
    expect(response.ok).toBe(true);
    const payload = await response.json() as { readonly data?: readonly unknown[] };
    expect(payload.data).toHaveLength(expectedCount);
  }, { interval: 3_000, timeout: 120_000 });
}

async function verifyLaravelCloudCredential(environment: PublicationSmokeEnvironment): Promise<void> {
  const url = new URL('https://cloud.laravel.com/api/applications');
  url.searchParams.set('filter[slug]', 'phpsandbox-sdk-credential-check');
  const response = await operation('verify Laravel Cloud credential', () => fetch(url, {
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${environment.laravelCloudApiKey!}`,
    },
  }));
  const body = await response.text();
  if (!response.ok) {
    throw new Error(
      `Laravel Cloud credential preflight returned ${response.status}: ${body.slice(0, 500)}`,
    );
  }
}

function markerUrl(baseUrl: string): string {
  return withPath(baseUrl, '/sdk-smoke');
}

function withPath(input: string, path: string): string {
  const url = new URL(input);
  url.pathname = path;
  return url.toString();
}

async function downloadRookInstaller(): Promise<string> {
  const response = await fetch(rookInstallerUrl);
  if (!response.ok) {
    throw new Error(`Rook installer returned ${response.status} ${response.statusText}.`);
  }
  const directory = await mkdtemp(join(tmpdir(), 'phpsandbox-sdk-rook-'));
  const path = join(directory, 'install.sh');
  await writeFile(path, await response.text(), { mode: 0o700 });
  return path;
}

async function uninstallRook(installer: string): Promise<void> {
  await executeFile('sudo', ['bash', installer, '--uninstall', '--purge'], { timeout: 120_000 });
}

async function commandSucceeds(command: string, args: readonly string[]): Promise<boolean> {
  try {
    await executeFile(command, [...args]);
    return true;
  } catch {
    return false;
  }
}
