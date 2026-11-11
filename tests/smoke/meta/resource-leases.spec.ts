import { ok } from 'node:assert/strict';
import { PHPSandbox, type PublicationProjectConfiguration, type PublicationApp, type PublicationData } from '@phpsandbox/sdk';
import { describe, expect, test, vi } from 'vitest';
import {
  createPublicationResourceLease,
  cleanupProjectPublication,
  isExpiredResourceLease,
  PublicationResourceLeaseRegistry,
  reapPublicationResources,
} from '../support/resource-leases.js';

const github = { owner: 'phpsandbox', token: 'secret-token' };
const registryEnvironment = { branch: 'smoke-resource-registry', repository: 'phpsandbox/fixtures' };

describe('publication resource leases', () => {
  test('uses immutable workflow identity and an exact optional server name', () => {
    expect(
      createPublicationResourceLease({
        projectId: 'project-smoke',
        appSlug: 'smoke-old-run',
        notebookId: 'notebook-1',
        provider: 'ssh-server',
        runAttempt: '2',
        runId: '12345',
        serverName: 'SDK Rook 12345.2',
        timestamp: new Date('2026-08-30T00:00:00.000Z'),
      })
    ).toEqual({
      projectId: 'project-smoke',
      appSlug: 'smoke-old-run',
      createdAt: '2026-08-30T00:00:00.000Z',
      notebookId: 'notebook-1',
      provider: 'ssh-server',
      runAttempt: '2',
      runId: '12345',
      server: { name: 'SDK Rook 12345.2' },
      publicationRequested: false,
      version: 2,
    });
  });

  test('expires a lease only after the configured age', () => {
    const lease = createPublicationResourceLease({
      projectId: 'project-smoke',
      appSlug: 'smoke-old-run',
      notebookId: 'notebook-1',
      provider: 'laravel-cloud',
      runAttempt: '1',
      runId: '12345',
      timestamp: new Date('2026-08-30T00:00:00.000Z'),
    });

    expect(isExpiredResourceLease(lease, 6, new Date('2026-08-30T05:59:59.999Z'))).toBe(false);
    expect(isExpiredResourceLease(lease, 6, new Date('2026-08-30T06:00:00.000Z'))).toBe(true);
  });

  test('writes leases to the provider directory without disclosing the token', async () => {
    const fetchImplementation = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          content: { sha: 'lease-sha' },
        }),
        { status: 201 }
      )
    );
    const registry = new PublicationResourceLeaseRegistry(github, registryEnvironment, fetchImplementation);
    const lease = createPublicationResourceLease({
      projectId: 'project-smoke',
      appSlug: 'smoke-old-run',
      notebookId: 'notebook-1',
      provider: 'cloudflare-containers',
      runAttempt: '1',
      runId: '12345',
      timestamp: new Date('2026-08-30T00:00:00.000Z'),
    });

    const stored = await registry.create(lease);

    expect(stored).toMatchObject({
      path: '.sdk-smoke/resource-leases/cloudflare-containers/12345.1.json',
      sha: 'lease-sha',
    });
    const [url, request] = fetchImplementation.mock.calls[0]!;
    const createRequest = new Request(url, request);
    expect(createRequest.url).toContain('/cloudflare-containers/12345.1.json');
    expect(request?.headers).toMatchObject({ Authorization: 'Bearer secret-token' });
    expect(await createRequest.json()).toMatchObject({ branch: 'smoke-resource-registry' });
    expect(request?.body).not.toContain('secret-token');
  });

  test('releases an unused lease when its project no longer exists', async () => {
    const lease = smokeLease();
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(Response.json({ error: { message: 'Not found', status: 404, code: 'NotFound' } }, { status: 404 }));
    const client = PHPSandbox.rest('test-token', 'https://api.example.test/v1', { fetch });
    const stored = { lease, path: 'lease.json', sha: 'lease-sha' };
    const registry = new PublicationResourceLeaseRegistry(
      github,
      registryEnvironment,
      vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response(null, { status: 200 }))
    );

    await expect(reapPublicationResources(client, registry, stored)).resolves.toBeUndefined();

    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch.mock.calls.every(([input]) => new Request(input).method === 'GET')).toBe(true);
  });

  test('a lease reserved before configuration intent never inspects or deletes existing project resources', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    const client = PHPSandbox.rest('test-token', 'https://api.example.test/v1', { fetch });
    const lease = createPublicationResourceLease({
      projectId: 'project-smoke',
      notebookId: 'notebook-1',
      provider: 'cloudflare-containers',
      runAttempt: '1',
      runId: '12345',
    });

    await cleanupProjectPublication(client, lease);

    expect(fetch).not.toHaveBeenCalled();
  });

  test('a stale lease deletes only its own deployment even when a newer same-provider deployment exists', async () => {
    const config = inventory();
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(Response.json({ data: config }))
      .mockResolvedValueOnce(Response.json({ data: required(config.deployments[0]).publication }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(Response.json({ data: { ...config, revision: 12 } }))
      .mockResolvedValueOnce(Response.json({ data: { ...config, revision: 13, apps: [newerApp] } }));
    const client = PHPSandbox.rest('test-token', 'https://api.example.test/v1', { fetch });
    const lease = { ...smokeLease(), appId: oldApp.id, publicationId: 'publication-old', publicationRequested: true };

    await cleanupProjectPublication(client, lease);

    const requests = fetch.mock.calls.map(([input]) => new Request(input));
    expect(requests.map((request) => `${request.method} ${new URL(request.url).pathname}`)).toEqual([
      'GET /v1/projects/project-smoke/publication/configuration',
      'GET /v1/publications/publication-old',
      'DELETE /v1/publications/publication-old',
      'GET /v1/projects/project-smoke/publication/configuration',
      'PATCH /v1/projects/project-smoke/publication/configuration',
    ]);
    expect(await required(requests[4]).json()).toEqual({
      expectedRevision: 12,
      operations: [{ op: 'remove-app', appId: oldApp.id }],
    });
  });

  test('recovers lost configuration and publication responses using the reserved exact slug', async () => {
    const config = inventory();
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(Response.json({ data: config }))
      .mockResolvedValueOnce(Response.json({ data: required(config.deployments[0]).publication }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(Response.json({ data: config }))
      .mockResolvedValueOnce(Response.json({ data: { ...config, apps: [newerApp] } }));
    const client = PHPSandbox.rest('test-token', 'https://api.example.test/v1', { fetch });

    await cleanupProjectPublication(client, { ...smokeLease(), publicationRequested: true });

    const requests = fetch.mock.calls.map(([input]) => new Request(input));
    expect(required(requests[1]).url).toBe('https://api.example.test/v1/publications/publication-old');
    expect(await required(requests[4]).json()).toEqual({
      expectedRevision: config.revision,
      operations: [{ op: 'remove-app', appId: oldApp.id }],
    });
  });

  test('retains the lease and avoids all deletion while the publication outcome is uncertain', async () => {
    const config = { ...inventory(), deployments: [] };
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(Response.json({ data: config }));
    const registryFetch = vi.fn<typeof globalThis.fetch>();
    const client = PHPSandbox.rest('test-token', 'https://api.example.test/v1', { fetch });
    const registry = new PublicationResourceLeaseRegistry(github, registryEnvironment, registryFetch);
    const stored = { lease: { ...smokeLease(), publicationRequested: true }, path: 'lease.json', sha: 'lease-sha' };

    await expect(reapPublicationResources(client, registry, stored)).rejects.toThrow('Publication outcome is not visible yet');

    expect(fetch).toHaveBeenCalledOnce();
    expect(registryFetch).not.toHaveBeenCalled();
  });

  test('refuses a recorded publication whose slug belongs to a different run', async () => {
    const config = { ...inventory(), deployments: [] };
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(Response.json({ data: config }))
      .mockResolvedValueOnce(
        Response.json({ data: { ...required(inventory().deployments[0]).publication, slug: 'smoke-newer-run' } })
      );
    const client = PHPSandbox.rest('test-token', 'https://api.example.test/v1', { fetch });

    await expect(cleanupProjectPublication(client, { ...smokeLease(), publicationId: 'publication-old' })).rejects.toThrow(
      'Refusing to delete a publication outside this smoke resource lease'
    );

    expect(fetch).toHaveBeenCalledTimes(2);
  });

  test('refuses a run-owned slug deployed through a different provider', async () => {
    const config = inventory();
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(Response.json({ data: config }))
      .mockResolvedValueOnce(
        Response.json({ data: { ...required(config.deployments[0]).publication, provider: { name: 'laravel-cloud' } } })
      );
    const client = PHPSandbox.rest('test-token', 'https://api.example.test/v1', { fetch });

    await expect(cleanupProjectPublication(client, smokeLease())).rejects.toThrow(
      'Refusing to delete a publication outside this smoke resource lease'
    );

    expect(fetch).toHaveBeenCalledTimes(2);
  });

  test.each([8, 17])(
    'removes only run-owned configuration at the current revision %s without requiring a fresh project',
    async (revision) => {
      const config = { ...inventory(), revision, deployments: [] };
      const fetch = vi
        .fn<typeof globalThis.fetch>()
        .mockResolvedValueOnce(Response.json({ data: config }))
        .mockResolvedValueOnce(Response.json({ data: { ...config, revision: revision + 1, apps: [newerApp] } }));
      const client = PHPSandbox.rest('test-token', 'https://api.example.test/v1', { fetch });

      await cleanupProjectPublication(client, smokeLease());

      const requests = fetch.mock.calls.map(([input]) => new Request(input));
      expect(await required(requests[1]).json()).toEqual({
        expectedRevision: revision,
        operations: [{ op: 'remove-app', appId: oldApp.id }],
      });
      expect(requests.map((request) => request.method)).toEqual(['GET', 'PATCH']);
    }
  );
});

function smokeLease() {
  return createPublicationResourceLease({
    projectId: 'project-smoke',
    notebookId: 'notebook-1',
    appSlug: 'smoke-old-run',
    provider: 'cloudflare-containers',
    runAttempt: '1',
    runId: '12345',
  });
}

const oldApp: PublicationApp = {
  id: 'app-old',
  name: 'Smoke app',
  kind: 'http',
  root: '.',
  build: { mode: 'dockerfile', dockerfile: { source: 'project', path: 'Dockerfile' } },
  runtime: { mode: 'container', port: 8080, healthCheck: { path: '/' } },
  destination: { provider: 'cloudflare-containers', accountId: 'test-account', size: 'nano', sleepAfter: '10m' },
  routing: { mode: 'managed', managedAddress: { slug: 'smoke-old-run', url: 'https://old.example.test' } },
  resourceIds: [],
};
const newerApp: PublicationApp = {
  ...oldApp,
  id: 'app-new',
  routing: { mode: 'managed', managedAddress: { slug: 'smoke-newer-run', url: 'https://new.example.test' } },
};

function inventory(): PublicationProjectConfiguration {
  const oldPublication: PublicationData = {
    id: 'publication-old',
    slug: 'smoke-old-run',
    provider: { name: 'cloudflare-containers', accountId: 'test-account', size: 'nano', sleepAfter: '10m' },
    status: 'healthy',
    url: 'https://old.example.test',
    strategy: 'rolling',
    protection: { enabled: false, mode: 'none' },
    eventStreamUrl: null,
    originUrl: null,
    deployedAt: null,
    createdAt: null,
    updatedAt: null,
  };
  return {
    schemaVersion: 1,
    proposal: null,
    id: 'configuration-1',
    revision: 7,
    apps: [oldApp, newerApp],
    resources: [{ id: 'preserved-database', kind: 'database', mode: 'none' }],
    deployments: [
      { appId: oldApp.id, configured: true, publication: oldPublication },
      {
        appId: newerApp.id,
        configured: true,
        publication: { ...oldPublication, id: 'publication-new', slug: 'smoke-newer-run', url: 'https://new.example.test' },
      },
    ],
  };
}

function required<T>(value: T | undefined): T {
  ok(value);
  return value;
}
