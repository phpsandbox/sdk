import { describe, expect, it, vi } from 'vitest';
import {
  laravelCloudSetupForRepublish,
  PHPSandbox,
  type LaravelCloudSetupInput,
  type PublicationPlanInput,
} from '../../src/index.js';

async function notebook() {
  return PHPSandbox.rest('token', 'https://api.example/v1', {
    fetch: vi.fn(async () =>
      Response.json({
        data: {
          id: 'nb',
          status: 'running',
          runtimeUrl: 'https://runtime.example/actions?ticket=test-ticket',
        },
      })
    ),
  }).notebook.get('nb');
}

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
            : {
                schemaVersion: 1,
                source: { repository: 'owner/repo', revision: 'abc123', root: '.' },
                components: [], resources: [], routes: [], assumptions: [], blockers: [], ready: true,
                input: { schemaVersion: 1, components: [] },
              },
        });
      }),
    });
    const nb = await client.notebook.get('nb');
    await nb.publication.prepareApplication({
      schemaVersion: 1,
      components: [{
        id: 'api', kind: 'http-service', root: 'apps/api',
        build: { mode: 'provider-native', workingDirectory: 'apps/api' },
        placement: { provider: 'laravel-cloud', region: 'eu-central-1' },
      }],
    });
    expect(requests[1]?.url).toBe('https://api.example/v1/notebook/nb/publication/application-plan');
    expect(requests[1]?.method).toBe('POST');
    expect(JSON.parse(await requests[1]!.text())).toMatchObject({ schemaVersion: 1 });
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
        return Response.json({ data: request.url.endsWith('/notebook/nb')
          ? { id: 'nb', status: 'running', runtimeUrl: 'https://runtime.example/actions?ticket=test-ticket' }
          : request.method === 'POST'
            ? { id: 'app-1', status: 'publishing', components: [{ componentId: 'api', publication: {
                id: 'component-1', slug: 'api', url: 'https://component.example', status: 'queued', strategy: 'custom',
                provider: { name: 'cloudflare-containers' }, capabilities: {}, protection: { mode: 'none', supported: true, enabled: false },
                eventStreamUrl: 'https://runtime.example/publish/component-1', originUrl: null, setupState: null, domains: [],
                currentRelease: null, latestBuild: null, deployedAt: null, createdAt: null, updatedAt: null,
              } }] }
            : { id: 'app-1', status: 'publishing', components: [] } });
      }),
    });
    const nb = await client.notebook.get('nb');
    const plan = { schemaVersion: 1 as const, slug: 'product', components: [{
      id: 'api', kind: 'http-service' as const, root: '.',
      build: { mode: 'dockerfile' as const, dockerfile: { source: 'generated' as const, content: 'FROM scratch' } },
      runtime: { kind: 'http' as const, port: 8080, healthCheck: { path: '/health' } },
      placement: { provider: 'cloudflare-containers' as const, accountId: 'a'.repeat(32) },
    }] };
    expect((await nb.publication.publishApplication(plan)).id).toBe('app-1');
    await nb.publication.application('app-1');
    await nb.publication.retryApplication('app-1');
    await nb.publication.destroyApplication('app-1', { deleteResources: true });
    expect(requests.slice(1).map((request) => [request.method, request.url])).toEqual([
      ['POST', 'https://api.example/v1/notebook/nb/publication/application'],
      ['GET', 'https://runtime.example/publish/component-1'],
      ['GET', 'https://api.example/v1/notebook/nb/publication/application/app-1'],
      ['POST', 'https://api.example/v1/notebook/nb/publication/application/app-1/retry'],
      ['GET', 'https://runtime.example/publish/component-1'],
      ['DELETE', 'https://api.example/v1/notebook/nb/publication/application/app-1?deleteResources=1'],
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
    await nb.publication.catalog('ssh-server', 'server/a');
    await nb.publication.catalog('laravel-cloud');
    await nb.publication.catalog('cloudflare-containers');
    expect(requests.slice(1).map((request) => ({ url: request.url, method: request.method }))).toEqual([
      {
        url: 'https://api.example/v1/notebook/nb/publication/catalog?provider=ssh-server&serverId=server%2Fa',
        method: 'GET',
      },
      {
        url: 'https://api.example/v1/notebook/nb/publication/catalog?provider=laravel-cloud',
        method: 'GET',
      },
      {
        url: 'https://api.example/v1/notebook/nb/publication/catalog?provider=cloudflare-containers',
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
            : { ready: false, blockers: [{ code: 'source.connect' }] },
        });
      }),
    });
    const nb = await client.notebook.get('nb');
    await nb.publication.readiness();
    const input: PublicationPlanInput = {
      provider: { name: 'ssh-server' },
      requirements: [{ kind: 'database', required: true, engine: 'mysql' }],
      resources: { database: { mode: 'external' } },
    };
    const plan = await nb.publication.prepare(input);
    expect(plan.ready).toBe(false);
    expect(requests.slice(1)).toEqual([
      { url: 'https://api.example/v1/notebook/nb/publication/readiness', method: 'GET', body: '' },
      {
        url: 'https://api.example/v1/notebook/nb/publication/plan',
        method: 'POST',
        body: JSON.stringify(input),
      },
    ]);
    nb.dispose();
  });
});
