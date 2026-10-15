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
  it('shares one server with an existing account, lists members, and revokes access', async () => {
    const requests: Array<{ method: string; url: string; body: unknown }> = [];
    const member = { id: 42, name: 'Teammate', email: 'teammate@example.test', access: 'deployer' };
    const fetch = vi.fn(async (request: Request) => {
      const body = await request.text();
      requests.push({ method: request.method, url: request.url, body: body ? JSON.parse(body) : undefined });
      if (request.method === 'DELETE') {
        return Response.json({ data: { deleted: true } });
      }
      if (request.url.includes('/members')) {
        return Response.json({ data: request.method === 'POST' ? member : [member], meta: { currentPage: 2 } });
      }
      return Response.json({ data: { ...serverData(), access: 'owner' } });
    }) as unknown as typeof globalThis.fetch;
    const client = PHPSandbox.rest('token', 'https://api.phpsandbox.io/v1', { fetch });
    const server = await client.servers.get('server-1');
    expect(server.data.access).toBe('owner');
    await expect(server.share(member.email)).resolves.toEqual(member);
    await expect(server.members({ page: 2 })).resolves.toMatchObject({ data: [member], meta: { currentPage: 2 } });
    await server.revokeAccess(member.id);
    expect(requests.slice(1)).toEqual([
      { method: 'POST', url: 'https://api.phpsandbox.io/v1/servers/server-1/members', body: { email: member.email } },
      { method: 'GET', url: 'https://api.phpsandbox.io/v1/servers/server-1/members?page=2', body: undefined },
      { method: 'DELETE', url: 'https://api.phpsandbox.io/v1/servers/server-1/members/42', body: undefined },
    ]);
  });

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
