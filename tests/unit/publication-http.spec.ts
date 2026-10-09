import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PHPSandbox, type PublicationPlan, type PublicationPlanInput } from '../../src/index.js';

describe('publication HTTP contract', () => {
  let server: Server;
  let origin: string;
  let ready: boolean;
  let clean: boolean;
  let pushedRevision: string;
  let requests: Array<{ method: string; path: string; body: unknown }>;

  beforeEach(async () => {
    ready = true;
    clean = false;
    pushedRevision = 'reviewed-revision';
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
          data = { id: 'nb', status: 'running', runtimeUrl: `${origin}/actions?ticket=runtime-ticket` };
          break;
        case '/v1/notebook/nb/publication/plan': {
          const input = body as PublicationPlanInput;
          const plan: PublicationPlan = {
            provider: input.provider.name,
            capabilities: {
              source: input.provider.name === 'ssh-server' ? 'workspace' : 'git',
              resources: { database: ['reuse'], cache: [], storage: [], worker: [], scheduler: [] }
            },
            readiness: {
              repository: 'owner/app',
              branch: 'main',
              sourceProvider: 'github',
              requirements: [],
              productionVariables: [],
              missingVariables: [],
              warnings: []
            },
            source: {
              type: 'git',
              repository: 'owner/app',
              branch: 'main',
              commitAndPush: input.provider.name !== 'ssh-server',
              providerAccess: 'confirmed'
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
                      setup: { database: { mode: 'reuse', id: 'retained-database' } }
                    }
            },
            cost: { status: 'unknown', message: 'Provider pricing applies.' }
          };
          data = plan;
          break;
        }
        case '/v1/notebook/nb/git/targets':
          data = [{ id: 'target', default: true, branch: 'main', repository: 'owner/app' }];
          break;
        case '/api/v1/notebooks/nb/runtime/git/status':
          data = { initialized: true, clean, branch: 'main', ref: clean ? 'reviewed-revision' : 'old-revision' };
          break;
        case '/api/v1/notebooks/nb/runtime/git/checkpoints':
          data = { ref: 'reviewed-revision' };
          break;
        case '/v1/notebook/nb/git/targets/target/sync':
          data = { id: 'target', default: true, branch: 'main', lastCommitSha: pushedRevision };
          break;
        case '/v1/notebook/nb/publication':
          if (request.method === 'GET') {
            response.statusCode = 404;
            response.end(JSON.stringify({ error: { status: 404, code: 'NotFound', message: 'Not published' } }));
            return;
          }
          data = {
            id: 'publication',
            eventStreamUrl: `${origin}/events`,
            provider: { name: 'laravel-cloud' },
            status: 'queued'
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
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterEach(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  });

  it('commits, verifies the push, publishes the resolved setup, and consumes the terminal stream', async () => {
    const notebook = await PHPSandbox.rest('test-token', `${origin}/v1`).notebook.get('nb');
    try {
      const run = await notebook.publishPlanned(
        {
          slug: 'app',
          provider: { name: 'laravel-cloud', region: 'eu-central-1' },
          resources: { database: { mode: 'reuse', id: 'retained-database' } }
        },
        { author: { name: 'Author', email: 'author@example.com' } }
      );
      await expect(run.result()).resolves.toMatchObject({ success: true, status: 'healthy' });
      const checkpoint = requests.findIndex((request) => request.path.endsWith('/checkpoints'));
      const sync = requests.findIndex((request) => request.path.endsWith('/sync'));
      const publish = requests.findIndex(
        (request) => request.method === 'POST' && request.path.endsWith('/publication')
      );
      expect(checkpoint).toBeGreaterThan(-1);
      expect(checkpoint).toBeLessThan(sync);
      expect(sync).toBeLessThan(publish);
      expect(requests[checkpoint].body).toEqual({
        author: 'Author <author@example.com>',
        message: 'Prepare publication',
        branch: 'main',
        allowEmpty: false
      });
      expect(requests[sync].body).toEqual({
        direction: 'push',
        author: { name: 'Author', email: 'author@example.com' }
      });
      expect(requests[publish].body).toEqual({
        slug: 'app',
        provider: {
          name: 'laravel-cloud',
          region: 'eu-central-1',
          setup: { database: { mode: 'reuse', id: 'retained-database' } }
        }
      });
    } finally {
      notebook.dispose();
    }
  });

  it('executes resolved workspace-provider settings without touching Git', async () => {
    const notebook = await PHPSandbox.rest('test-token', `${origin}/v1`).notebook.get('nb');
    try {
      const run = await notebook.publishPlanned({
        slug: 'app',
        provider: { name: 'ssh-server', serverId: 'requested-server' }
      });
      await expect(run.result()).resolves.toMatchObject({ success: true });
      expect(requests.some((request) => request.path.includes('/git/'))).toBe(false);
      expect(
        requests.find((request) => request.method === 'POST' && request.path.endsWith('/publication'))?.body
      ).toEqual({ slug: 'app', provider: { name: 'ssh-server', serverId: 'resolved-server' } });
    } finally {
      notebook.dispose();
    }
  });

  it('a blocked plan stops before any Git or publication mutation', async () => {
    ready = false;
    const notebook = await PHPSandbox.rest('test-token', `${origin}/v1`).notebook.get('nb');
    try {
      await expect(
        notebook.publishPlanned({ slug: 'app', provider: { name: 'laravel-cloud', region: 'eu-central-1' } })
      ).rejects.toThrow('Connect repository access');
      expect(requests.map((request) => request.path)).toEqual(['/v1/notebook/nb', '/v1/notebook/nb/publication/plan']);
    } finally {
      notebook.dispose();
    }
  });

  it('rejects a stale remote revision before starting a publication', async () => {
    clean = true;
    pushedRevision = 'older-revision';
    const notebook = await PHPSandbox.rest('test-token', `${origin}/v1`).notebook.get('nb');
    try {
      await expect(
        notebook.publishPlanned(
          { slug: 'app', provider: { name: 'laravel-cloud', region: 'eu-central-1' } },
          { author: { name: 'Author', email: 'author@example.com' } }
        )
      ).rejects.toThrow('have not reached the repository');
      expect(requests.some((request) => request.path.endsWith('/checkpoints'))).toBe(false);
      expect(requests.some((request) => request.method === 'POST' && request.path.endsWith('/publication'))).toBe(
        false
      );
    } finally {
      notebook.dispose();
    }
  });
});
