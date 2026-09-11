import { describe, expect, it, vi } from 'vitest';
import { PHPSandbox } from '../../src/index.js';

function serverData(status: string = 'pending') {
  return {
    id: 'server-1',
    name: 'Production server',
    host: 'server.example.test',
    provider: 'ssh',
    status,
    connectedAt: null,
    createdAt: null,
    updatedAt: null,
  };
}

describe('Server API', () => {
  it('lists, creates, refreshes, and deletes server resources', async () => {
    const requests: Array<{ method: string; url: string; body: unknown }> = [];
    const fetch = vi.fn(async (request: Request) => {
      const text = await request.text();
      requests.push({
        method: request.method,
        url: request.url,
        body: text === '' ? undefined : JSON.parse(text),
      });

      if (request.method === 'DELETE') {
        return Response.json({ data: { deleted: true } });
      }

      if (request.method === 'GET' && request.url.includes('?page=')) {
        return Response.json({ data: [serverData()], meta: { currentPage: 2 } });
      }

      return Response.json({ data: serverData() });
    }) as unknown as typeof globalThis.fetch;
    const client = PHPSandbox.rest('token', 'https://api.phpsandbox.io/v1', { fetch });

    await expect(client.servers.list({ page: 2 })).resolves.toMatchObject({
      data: [{ id: 'server-1' }],
      meta: { currentPage: 2 },
    });
    const created = await client.servers.create({
      name: 'Production server',
      host: 'server.example.test',
      ssh: { user: 'deploy', port: 2222 },
    });
    await created.refresh();
    await created.delete();

    expect(requests).toEqual([
      {
        method: 'GET',
        url: 'https://api.phpsandbox.io/v1/servers?page=2',
        body: undefined,
      },
      {
        method: 'POST',
        url: 'https://api.phpsandbox.io/v1/servers',
        body: {
          name: 'Production server',
          host: 'server.example.test',
          ssh: { user: 'deploy', port: 2222 },
        },
      },
      {
        method: 'GET',
        url: 'https://api.phpsandbox.io/v1/servers/server-1',
        body: undefined,
      },
      {
        method: 'DELETE',
        url: 'https://api.phpsandbox.io/v1/servers/server-1',
        body: undefined,
      },
    ]);
  });

  it('waits for a pending server and rejects a failed server', async () => {
    const statuses = ['pending', 'connected', 'failed'];
    const fetch = vi.fn(async () => Response.json({ data: serverData(statuses.shift()) }));
    const client = PHPSandbox.rest('token', 'https://api.phpsandbox.io/v1', {
      fetch: fetch as unknown as typeof globalThis.fetch,
    });
    const pending = await client.servers.get('server-1');

    await expect(pending.waitReady({ interval: 0 })).resolves.toMatchObject({
      data: { status: 'connected' },
    });
    await expect(pending.waitReady({ interval: 0 })).rejects.toThrow(
      'Server provisioning failed: server-1',
    );
  });
});
