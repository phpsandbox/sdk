import { createServer, type Server } from 'node:http';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { PHPSandbox, RemoteError, type PublicationPlan, type PublicationPlanInput } from '../../src/index.js';

describe('publication HTTP contract', () => {
  let server: Server;
  let origin: string;
  let ready: boolean;
  let requests: Array<{ method: string; path: string; body: unknown }>;

  beforeEach(async () => {
    ready = true;
    requests = [];
    server = createServer(async (request, response) => {
      const chunks: Buffer[] = [];
      for await (const chunk of request) {
        chunks.push(chunk);
      }
      const text = Buffer.concat(chunks).toString();
      const body = text ? JSON.parse(text) : undefined;
      const path = new URL(request.url!, origin).pathname;
      requests.push({ method: request.method!, path, body });
      response.setHeader('Content-Type', 'application/json');
      let data: unknown;
      switch (path) {
        case '/v1/notebook/nb':
          data = {
            id: 'nb',
            status: 'running',
            runtimeUrl: `${origin}/actions?ticket=runtime-ticket`,
          };
          break;
        case '/v1/notebook/nb/publication/plan': {
          const input = z.object({ provider: z.object({ name: z.enum(['ssh-server', 'laravel-cloud']) }) }).parse(body);
          const plan: PublicationPlan = {
            provider: input.provider.name,
            capabilities: {
              source: input.provider.name === 'ssh-server' ? 'workspace' : 'git',
              resources: { database: ['reuse'], cache: [], storage: [], worker: [], scheduler: [] },
            },
            readiness: {
              repository: 'owner/app',
              branch: 'main',
              sourceProvider: 'github',
              requirements: [],
              productionVariables: [],
              missingVariables: [],
              warnings: [],
            },
            source: {
              type: 'git',
              repository: 'owner/app',
              branch: 'main',
              commitAndPush: input.provider.name !== 'ssh-server',
              providerAccess: 'confirmed',
            },
            resources: [],
            blockers: ready ? [] : [{ code: 'source.provider_access', message: 'Connect repository access' }],
            ready,
            input: {
              provider:
                input.provider.name === 'ssh-server'
                  ? { name: 'ssh-server', serverId: 'resolved-server' }
                  : {
                      name: 'laravel-cloud',
                      region: 'eu-central-1',
                      setup: { database: { mode: 'reuse', id: 'retained-database' } },
                    },
            },
            cost: { status: 'unknown', message: 'Provider pricing applies.' },
          };
          data = plan;
          break;
        }
        case '/v1/notebook/nb/publication':
          if (request.method === 'GET') {
            response.statusCode = 404;
            response.end(
              JSON.stringify({
                error: { status: 404, code: 'NotFound', message: 'Not published' },
              })
            );
            return;
          }
          if (!ready) {
            response.statusCode = 422;
            response.end(
              JSON.stringify({
                error: {
                  status: 422,
                  code: 'UnprocessableEntity',
                  message: 'Connect repository access',
                  details: { errors: { publication: ['Connect repository access'] } },
                },
              })
            );
            return;
          }
          data = {
            id: 'publication',
            eventStreamUrl: `${origin}/events`,
            provider: { name: 'laravel-cloud' },
            status: 'queued',
          };
          break;
        case '/events':
          response.setHeader('Content-Type', 'text/event-stream');
          response.end(
            'event: result\ndata: {"success":true,"publicationId":"publication","url":"https://app.example.test","buildId":"build","releaseId":"release","status":"healthy"}\n\n'
          );
          return;
        default:
          response.statusCode = 500;
          response.end(JSON.stringify({ error: { message: `Unexpected request: ${path}` } }));
          return;
      }
      response.end(JSON.stringify({ data }));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Test server has no TCP address.');
    }
    origin = `http://127.0.0.1:${address.port}`;
  });

  afterEach(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  });

  it('submits generic selections to Core and consumes the terminal stream without coordinating Git', async () => {
    const notebook = await PHPSandbox.rest('test-token', `${origin}/v1`).notebook.get('nb');
    try {
      const input: PublicationPlanInput<'laravel-cloud'> & { slug: string } = {
        slug: 'app',
        provider: { name: 'laravel-cloud', region: 'eu-central-1' },
        resources: { database: { mode: 'reuse', id: 'retained-database' } },
      };
      const run = await notebook.publication.publish({
        ...input,
        provider: { name: 'laravel-cloud', region: 'eu-central-1' },
      });
      await expect(run.result()).resolves.toMatchObject({ success: true, status: 'healthy' });
      expect(requests.map((request) => request.path)).toEqual(['/v1/notebook/nb', '/v1/notebook/nb/publication', '/events']);
      expect(requests[1].body).toEqual(input);
    } finally {
      notebook.dispose();
    }
  });

  it('preparing a review does not publish or touch Git', async () => {
    const notebook = await PHPSandbox.rest('test-token', `${origin}/v1`).notebook.get('nb');
    try {
      ready = false;
      const plan = await notebook.publication.prepare({ provider: { name: 'ssh-server' } });
      expect(plan.ready).toBe(false);
      expect(requests.map((request) => request.path)).toEqual(['/v1/notebook/nb', '/v1/notebook/nb/publication/plan']);
    } finally {
      notebook.dispose();
    }
  });

  it('direct publishing surfaces backend validation through RemoteError', async () => {
    ready = false;
    const notebook = await PHPSandbox.rest('test-token', `${origin}/v1`).notebook.get('nb');
    try {
      const promise = notebook.publication.publish({
        slug: 'app',
        provider: { name: 'laravel-cloud', region: 'eu-central-1' },
      });
      await expect(promise).rejects.toBeInstanceOf(RemoteError);
      expect(requests.some((request) => request.path.includes('/git/'))).toBe(false);
      expect(requests.some((request) => request.path.endsWith('/plan'))).toBe(false);
    } finally {
      notebook.dispose();
    }
  });

  it('publishing again uses the same backend endpoint with no separate preparation calls', async () => {
    const notebook = await PHPSandbox.rest('test-token', `${origin}/v1`).notebook.get('nb');
    try {
      const run = await notebook.publication.publish();
      await expect(run.result()).resolves.toMatchObject({ success: true });
      expect(requests[1]).toMatchObject({ method: 'POST', path: '/v1/notebook/nb/publication' });
      expect(requests[1].body).toBeUndefined();
    } finally {
      notebook.dispose();
    }
  });
});
