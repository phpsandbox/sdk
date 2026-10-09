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
