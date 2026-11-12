import { describe, expect, it, vi } from 'vitest';
import {
  laravelCloudSetupForRepublish,
  PHPSandbox,
  type LaravelCloudSetupInput,
  type PublicationApplicationPlanInput,
  type PublicationReadiness,
} from '../../src/index.js';

describe('publication planning', () => {
  it('prepares a multi-component application plan without publishing', async () => {
    const requests: Request[] = [];
    const client = PHPSandbox.rest('token', 'https://api.example/v1', {
      fetch: vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const request = new Request(input, init);
        requests.push(request);
        return Response.json({
          data: request.url.endsWith('/notebook/nb')
            ? { id: 'nb', status: 'running', runtimeUrl: 'https://runtime.example/actions?ticket=test-ticket' }
            : { schemaVersion: 1, apps: [] },
        });
      }),
    });
    const nb = await client.notebook.get('nb');
    await client.publications.forProject('project-1').prepare({ expectedRevision: 3, appIds: ['stable-api-id'] });
    expect(requests[1]?.url).toBe('https://api.example/v1/projects/project-1/publication/plan');
    expect(requests[1]?.method).toBe('POST');
    expect(JSON.parse(await requests[1]!.text())).toEqual({ expectedRevision: 3, appIds: ['stable-api-id'] });
    nb.dispose();
  });
  it('inspects inventory and submits explicit revision-checked edits without publishing', async () => {
    const requests: Request[] = [];
    const client = PHPSandbox.rest('token', 'https://api.example/v1', {
      fetch: vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const request = new Request(input, init);
        requests.push(request);
        return Response.json({
          data: request.url.endsWith('/notebook/nb')
            ? { id: 'nb', status: 'running', runtimeUrl: 'https://runtime.example/actions?ticket=test-ticket' }
            : {
                schemaVersion: 1,
                id: 'project',
                revision: 4,
                apps: [],
                resources: [],
                deployments: [{ appId: 'removed', configured: false, publication: { id: 'still-running', status: 'healthy' } }],
              },
        });
      }),
    });
    const nb = await client.notebook.get('nb');
    const config = await client.publications.forProject('project-1').configuration();
    expect(config.deployments[0]?.publication.id).toBe('still-running');
    await client.publications
      .forProject('project-1')
      .updateConfiguration({ expectedRevision: 4, operations: [{ op: 'remove-app', appId: 'removed' }] });
    expect(requests.slice(1).map((request) => [request.method, request.url])).toEqual([
      ['GET', 'https://api.example/v1/projects/project-1/publication/configuration'],
      ['PATCH', 'https://api.example/v1/projects/project-1/publication/configuration'],
    ]);
    expect(await requests[2]!.json()).toEqual({ expectedRevision: 4, operations: [{ op: 'remove-app', appId: 'removed' }] });
    nb.dispose();
  });
  it('returns a changed proposal without starting any runtime execution', async () => {
    const requests: Request[] = [];
    const pending = {
      confirmationRequired: true,
      plan: { review: { id: 'updated', proposal: 'updated-signed' } },
      changes: ['Frontend: hosting destination changed.'],
    };
    const client = PHPSandbox.rest('token', 'https://api.example/v1', {
      fetch: vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const request = new Request(input, init);
        requests.push(request);
        return Response.json({
          data: request.url.endsWith('/notebook/nb')
            ? { id: 'nb', status: 'running', runtimeUrl: 'https://runtime.example/actions?ticket=test-ticket' }
            : pending,
        });
      }),
    });
    const nb = await client.notebook.get('nb');
    expect(
      await client.publications.forProject('project-1').publish({ reviewId: 'shown', proposal: 'signed', appIds: ['frontend'] })
    ).toEqual(pending);
    expect(requests).toHaveLength(2);
    expect(await requests[1].clone().json()).toEqual({ reviewId: 'shown', proposal: 'signed', appIds: ['frontend'] });
    nb.dispose();
  });
  it('publishes, reads and cleans up every component in an application plan', async () => {
    const requests: Request[] = [];
    const client = PHPSandbox.rest('token', 'https://api.example/v1', {
      fetch: vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const request = new Request(input, init);
        requests.push(request);
        if (request.url === 'https://runtime.example/publish/component-1') {
          return new Response('event: result\ndata: {"url":"https://component.example"}\n\n', {
            headers: { 'content-type': 'text/event-stream' },
          });
        }
        return Response.json({
          data: request.url.endsWith('/notebook/nb')
            ? { id: 'nb', status: 'running', runtimeUrl: 'https://runtime.example/actions?ticket=test-ticket' }
            : request.method === 'POST'
              ? {
                  id: 'app-1',
                  selectedAppIds: ['api'],
                  status: 'publishing',
                  apps: [
                    {
                      appId: 'api',
                      publication: {
                        id: 'component-1',
                        slug: 'api',
                        url: 'https://component.example',
                        status: 'queued',
                        strategy: 'custom',
                        provider: { name: 'cloudflare-containers' },
                        capabilities: {},
                        protection: { mode: 'none', supported: true, enabled: false },
                        eventStreamUrl: 'https://runtime.example/publish/component-1',
                        originUrl: null,
                        setupState: null,
                        domains: [],
                        currentRelease: null,
                        latestBuild: null,
                        deployedAt: null,
                        createdAt: null,
                        updatedAt: null,
                      },
                    },
                  ],
                }
              : { id: 'app-1', selectedAppIds: ['api'], status: 'publishing', apps: [] },
        });
      }),
    });
    const nb = await client.notebook.get('nb');
    expect(
      await client.publications.forProject('project-1').publish({ reviewId: 'review-1', proposal: 'signed-proposal' })
    ).toMatchObject({ id: 'app-1' });
    expect(
      await requests
        .find((request) => request.url.endsWith('/publication'))!
        .clone()
        .json()
    ).toEqual({ reviewId: 'review-1', proposal: 'signed-proposal' });
    await client.publications.forProject('project-1').application('app-1');
    await client.publications.forProject('project-1').retryApplication('app-1');
    await client.publications.forProject('project-1').destroyApplication('app-1', { deleteResources: true });
    expect(requests.slice(1).map((request) => [request.method, request.url])).toEqual([
      ['POST', 'https://api.example/v1/projects/project-1/publication'],
      ['GET', 'https://runtime.example/publish/component-1'],
      ['GET', 'https://api.example/v1/projects/project-1/publication/application/app-1'],
      ['POST', 'https://api.example/v1/projects/project-1/publication/application/app-1/retry'],
      ['GET', 'https://runtime.example/publish/component-1'],
      ['DELETE', 'https://api.example/v1/projects/project-1/publication/application/app-1?deleteResources=1'],
    ]);
    nb.dispose();
  });
  it('publishing a selected healthy frontend never starts a queued unselected backend', async () => {
    const requests: Request[] = [];
    const client = PHPSandbox.rest('token', 'https://api.example/v1', {
      fetch: vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const request = new Request(input, init);
        requests.push(request);
        return Response.json({
          data: request.url.endsWith('/notebook/nb')
            ? { id: 'nb', status: 'running', runtimeUrl: 'https://runtime.example/actions?ticket=test-ticket' }
            : {
                id: 'project',
                status: 'publishing',
                selectedAppIds: ['frontend'],
                apps: [
                  { appId: 'frontend', publication: { status: 'healthy' } },
                  {
                    appId: 'backend',
                    publication: {
                      id: 'backend-publication',
                      status: 'queued',
                      eventStreamUrl: 'https://runtime.example/publish/backend-publication',
                    },
                  },
                ],
              },
        });
      }),
    });
    const nb = await client.notebook.get('nb');
    await client.publications.forProject('project-1').publish({ reviewId: 'frontend-review', proposal: 'signed-proposal' });
    expect(requests.map((request) => request.url)).toEqual([
      'https://api.example/v1/notebook/nb',
      'https://api.example/v1/projects/project-1/publication',
    ]);
    nb.dispose();
  });
  it('requests provider catalogs with an encoded SSH server scope without publishing', async () => {
    const requests: Request[] = [];
    const client = PHPSandbox.rest('token', 'https://api.example/v1', {
      fetch: vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const request = new Request(input, init);
        requests.push(request);
        return Response.json({
          data: request.url.endsWith('/notebook/nb')
            ? {
                id: 'nb',
                status: 'running',
                runtimeUrl: 'https://runtime.example/actions?ticket=test-ticket',
              }
            : { regions: [], resourceTypes: [], resources: [] },
        });
      }),
    });
    const nb = await client.notebook.get('nb');
    await client.publications.forProject('project-1').catalog('ssh-server', 'server/a');
    await client.publications.forProject('project-1').catalog('laravel-cloud');
    await client.publications.forProject('project-1').catalog('cloudflare-containers');
    expect(requests.slice(1).map((request) => ({ url: request.url, method: request.method }))).toEqual([
      {
        url: 'https://api.example/v1/projects/project-1/publication/catalog?provider=ssh-server&serverId=server%2Fa',
        method: 'GET',
      },
      {
        url: 'https://api.example/v1/projects/project-1/publication/catalog?provider=laravel-cloud',
        method: 'GET',
      },
      {
        url: 'https://api.example/v1/projects/project-1/publication/catalog?provider=cloudflare-containers',
        method: 'GET',
      },
    ]);
    nb.dispose();
  });
  it('reuses retained resources after unpublish without changing the saved setup', () => {
    const setup: LaravelCloudSetupInput = {
      database: { mode: 'create', type: 'laravel_mysql' },
      cache: { mode: 'reuse', id: 'existing' },
      storage: { mode: 'create' },
      worker: true,
    };
    expect(laravelCloudSetupForRepublish(setup, { databaseId: 'schema', storageId: 'key' })).toEqual({
      database: { mode: 'reuse', id: 'schema' },
      cache: { mode: 'reuse', id: 'existing' },
      storage: { mode: 'reuse', id: 'key' },
      worker: true,
    });
    expect(setup.database.mode).toBe('create');
    expect(laravelCloudSetupForRepublish(setup)).toEqual(setup);
  });
  it('preserves a discovered project Dockerfile while retaining native framework readiness', async () => {
    const expected: PublicationReadiness = {
      repository: null,
      branch: null,
      sourceProvider: null,
      requirements: [],
      productionVariables: [],
      missingVariables: [],
      warnings: [],
      defaultBuild: 'laravel',
      defaultDockerfile: '.psb/deploy/Dockerfile',
    };
    const requests: Request[] = [];
    const client = PHPSandbox.rest('token', 'https://api.example.test/v1', {
      fetch: async (input, init) => {
        const request = new Request(input, init);
        requests.push(request);
        expect(request.method).toBe('GET');
        expect(new URL(request.url).pathname).toBe('/v1/projects/course/publication/readiness');
        return Response.json({ data: expected });
      },
    });

    const readiness = await client.publications.forProject('course').readiness();

    expect(readiness).toEqual(expected);
    expect(requests).toHaveLength(1);
  });

  it('uses the shared readiness and planning endpoints without starting a deployment', async () => {
    const requests: Array<{ url: string; method: string; body: string }> = [];
    const client = PHPSandbox.rest('token', 'https://api.example/v1', {
      fetch: vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const request = new Request(input, init);
        requests.push({ url: request.url, method: request.method, body: await request.text() });
        return Response.json({
          data: request.url.endsWith('/notebook/nb')
            ? {
                id: 'nb',
                status: 'running',
                runtimeUrl: 'https://runtime.example/actions?ticket=test-ticket',
              }
            : { review: { ready: false, blockers: [{ code: 'source.connect' }] } },
        });
      }),
    });
    const nb = await client.notebook.get('nb');
    await client.publications.forProject('project-1').readiness();
    const input: PublicationApplicationPlanInput = { expectedRevision: 4, appIds: ['backend'] };
    const plan = await client.publications.forProject('project-1').prepare(input);
    expect(plan.review.ready).toBe(false);
    expect(requests.slice(1)).toEqual([
      { url: 'https://api.example/v1/projects/project-1/publication/readiness', method: 'GET', body: '' },
      {
        url: 'https://api.example/v1/projects/project-1/publication/plan',
        method: 'POST',
        body: JSON.stringify(input),
      },
    ]);
    nb.dispose();
  });
});
