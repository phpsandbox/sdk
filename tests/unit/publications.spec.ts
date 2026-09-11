import { describe, expect, it, vi } from 'vitest';
import { PHPSandbox, RemoteError } from '../../src/index.js';

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify({ data }), { status, headers: { 'Content-Type': 'application/json' } });
}

function errorResponse(status: number, code: string, message: string): Response {
  return new Response(JSON.stringify({ error: { status, code, message } }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function publicationData(overrides: Record<string, unknown> = {}) {
  return {
    id: 'pub_123',
    slug: 'my-app',
    url: 'https://my-app.example.test',
    status: 'healthy',
    strategy: 'laravel',
    provider: { name: 'cloudflare-containers', accountId: '0123456789abcdef0123456789abcdef', size: 'small', sleepAfter: '30m', instances: 1 },
    protection: { mode: 'none', enabled: false },
    eventStreamUrl: 'https://runtime.phpsandbox.io/publish/pub_123',
    originUrl: null,
    latestBuild: {
      id: 'build_123',
      status: 'succeeded',
      strategy: 'laravel',
      provider: { name: 'cloudflare-containers', accountId: '0123456789abcdef0123456789abcdef', size: 'small', sleepAfter: '30m', instances: 1 },
      errorMessage: null,
      startedAt: null,
      finishedAt: null,
    },
    currentRelease: null,
    deployedAt: null,
    createdAt: null,
    updatedAt: null,
    ...overrides,
  };
}

function publishStream(): Response {
  const events = [
    ['phase', { name: 'building', status: 'running' }],
    ['log', { stream: 'publish', content: 'Publishing' }],
    ['result', {
      success: true,
      publicationId: 'pub_123',
      url: 'https://canonical.example.test',
      buildId: 'build_123',
      releaseId: 'release_123',
      status: 'healthy',
    }],
  ];
  const body = events.map(([event, data]) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`).join('');
  return new Response(body, { headers: { 'Content-Type': 'text/event-stream' } });
}

function openNotebook(client: PHPSandbox, id: string) {
  return client.notebook.open({
    id,
    runtimeUrl: 'https://runtime.example.test',
    gitUrl: 'https://git.example.test',
  });
}

describe('Publications', () => {
  it('publishes through the notebook-scoped API and exposes an AsyncIterable run', async () => {
    const requests: Request[] = [];
    const fetch = vi.fn(async (request: Request) => {
      requests.push(request);
      return request.headers.get('Accept') === 'text/event-stream'
        ? publishStream()
        : jsonResponse(publicationData(), 201);
    }) as unknown as typeof globalThis.fetch;
    const client = PHPSandbox.realtime('token', 'https://api.phpsandbox.io/v1', { fetch });

    const run = await openNotebook(client, 'nb_123').publish({
      slug: 'my-app',
      provider: { name: 'cloudflare-containers', accountId: '0123456789abcdef0123456789abcdef', size: 'medium', placement: { regions: ['WEUR'] } },
      protection: { mode: 'password', password: 'publication-password' },
    });
    const events = [];
    for await (const event of run.events()) {
      events.push(event);
    }

    expect(events.map((event) => event.type)).toEqual(['phase', 'log', 'result']);
    await expect(run.result()).resolves.toMatchObject({
      publicationId: 'pub_123',
      status: 'healthy',
      url: 'https://canonical.example.test',
    });
    expect(requests[0].url).toBe('https://api.phpsandbox.io/v1/notebook/nb_123/publication');
    await expect(requests[0].json()).resolves.toMatchObject({
      provider: { name: 'cloudflare-containers', accountId: '0123456789abcdef0123456789abcdef', size: 'medium' },
      protection: { mode: 'password' },
    });
    expect(requests[1].url).toBe('https://runtime.phpsandbox.io/publish/pub_123');
    expect(requests).toHaveLength(2);
  });

  it('publishes to Laravel Cloud through the sandbox integration', async () => {
    const requests: Request[] = [];
    const fetch = vi.fn(async (request: Request) => {
      requests.push(request);
      if (request.headers.get('Accept') === 'text/event-stream') {
        return publishStream();
      }
      return jsonResponse(publicationData({
        provider: {
          name: 'laravel-cloud',
          region: 'eu-central-1',
          repository: 'phpsandbox/app',
          branch: 'main',
        },
      }), 201);
    }) as unknown as typeof globalThis.fetch;
    const client = PHPSandbox.realtime('token', 'https://api.phpsandbox.io/v1', { fetch });

    const run = await openNotebook(client, 'nb_123').publish({
      slug: 'my-app',
      provider: {
        name: 'laravel-cloud',
        region: 'eu-central-1',
      },
    });

    expect(run.initial.data.provider).toMatchObject({ name: 'laravel-cloud', region: 'eu-central-1' });
    expect(run.initial.data.provider).not.toHaveProperty('integration');
    await expect(requests[0].json()).resolves.toMatchObject({
      provider: { name: 'laravel-cloud', region: 'eu-central-1' },
    });
  });

  it('gets the current publication or null', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(jsonResponse(publicationData()))
      .mockResolvedValueOnce(errorResponse(404, 'NotFound', 'No publication.'));
    const client = PHPSandbox.realtime('token', 'https://api.phpsandbox.io/v1', { fetch });

    await expect(openNotebook(client, 'nb_123').publication()).resolves.toMatchObject({ data: { id: 'pub_123' } });
    await expect(openNotebook(client, 'nb_456').publication()).resolves.toBeNull();
  });

  it('republishes an existing notebook publication without setup input', async () => {
    const requests: Request[] = [];
    const fetch = vi.fn(async (request: Request) => {
      requests.push(request);
      if (request.headers.get('Accept') === 'text/event-stream') {
        return publishStream();
      }
      return jsonResponse(publicationData(), request.method === 'POST' ? 202 : 200);
    }) as unknown as typeof globalThis.fetch;
    const client = PHPSandbox.realtime('token', 'https://api.phpsandbox.io/v1', { fetch });

    const publication = await openNotebook(client, 'nb_123').publication();
    await (await publication!.publish()).result();

    expect(requests.map((request) => request.method)).toEqual(['GET', 'POST', 'GET']);
    await expect(requests[1].text()).resolves.toBe('');
  });

  it('uses destroy for destructive publication removal', async () => {
    const requests: Request[] = [];
    const fetch = vi.fn(async (request: Request) => {
      requests.push(request);
      return request.method === 'GET'
        ? jsonResponse(publicationData())
        : jsonResponse({ message: 'Publication destroyed.' });
    }) as unknown as typeof globalThis.fetch;
    const client = PHPSandbox.realtime('token', 'https://api.phpsandbox.io/v1', { fetch });

    const publication = await client.publications.get('pub_123');
    await publication.destroy();

    expect(requests[1].method).toBe('DELETE');
    expect(requests[1].url).toBe('https://api.phpsandbox.io/v1/publications/pub_123');
  });

  it('parses publication event streams as NDJSON', async () => {
    const fetch = vi.fn(async (request: Request) => request.url.endsWith('/events/stream')
      ? new Response(
        [
          '{"sequence":1,"type":"build.started","payload":{},"createdAt":null}',
          '{"sequence":2,"type":"build.completed","payload":[],"createdAt":null}',
        ].join('\n'),
        { headers: { 'Content-Type': 'application/x-ndjson' } },
      )
      : jsonResponse(publicationData())) as unknown as typeof globalThis.fetch;
    const client = PHPSandbox.realtime('token', 'https://api.phpsandbox.io/v1', { fetch });

    const publication = await client.publications.get('pub_123');
    const reader = (await publication.events()).getReader();
    await expect(reader.read()).resolves.toMatchObject({ value: { sequence: 1, type: 'build.started' } });
    await expect(reader.read()).resolves.toMatchObject({
      value: { sequence: 2, type: 'build.completed', payload: {} },
    });
  });

  it('surfaces parsed API errors', async () => {
    const fetch = vi.fn(async (request: Request) => request.method === 'GET'
      ? jsonResponse(publicationData())
      : errorResponse(422, 'UnprocessableEntity', 'Invalid protection settings.')) as unknown as typeof globalThis.fetch;
    const client = PHPSandbox.realtime('token', 'https://api.phpsandbox.io/v1', { fetch });

    const publication = await client.publications.get('pub_123');
    await expect(publication.setProtection({ mode: 'password', password: 'secret' }))
      .rejects.toMatchObject({
        source: 'core',
        status: 422,
        code: 'UnprocessableEntity',
        message: 'Invalid protection settings.',
      } satisfies Partial<RemoteError>);
  });

  it('waits until publication status is terminal', async () => {
    const responses = [
      publicationData({ status: 'building' }),
      publicationData({ status: 'deploying' }),
      publicationData({ status: 'healthy' }),
    ];
    const fetch = vi.fn(async () => jsonResponse(responses.shift())) as unknown as typeof globalThis.fetch;
    const client = PHPSandbox.realtime('token', 'https://api.phpsandbox.io/v1', { fetch });

    const publication = await client.publications.get('pub_123');
    const result = await publication.wait({ intervalMs: 1, timeoutMs: 1000 });

    expect(result.data.status).toBe('healthy');
  });
});
