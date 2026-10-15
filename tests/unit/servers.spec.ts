import { describe, expect, it, vi } from 'vitest';
import { PHPSandbox, type ServerData } from '../../src/index.js';

function serverData(status: string = 'pending'): ServerData {
  return {
    id: 'server-1',
    name: 'Production server',
    host: 'server.example.test',
    provider: 'ssh',
    status,
    access: 'owner',
    connectedAt: null,
    createdAt: null,
    updatedAt: null,
  };
}

describe('Server API', () => {
  it('shares one server with an existing account, lists members, and revokes access', async () => {
    const member = { id: 42, name: 'Teammate', email: 'teammate@example.test', access: 'deployer' };
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(Response.json({ data: serverData() }))
      .mockResolvedValueOnce(Response.json({ data: member }))
      .mockResolvedValueOnce(Response.json({ data: [member], meta: { currentPage: 2 } }))
      .mockResolvedValueOnce(Response.json({ data: { deleted: true } }));
    const client = PHPSandbox.rest('token', 'https://api.phpsandbox.io/v1', { fetch });
    const server = await client.servers.get('server-1');
    expect(server.data.access).toBe('owner');
    await expect(server.share(member.email)).resolves.toEqual(member);
    await expect(server.members({ page: 2 })).resolves.toMatchObject({ data: [member], meta: { currentPage: 2 } });
    await server.revokeAccess(member.id);
    const requests = fetch.mock.calls.map(([request]) => request as Request);
    expect(requests.map((request) => [request.method, request.url])).toEqual([
      ['GET', 'https://api.phpsandbox.io/v1/servers/server-1'],
      ['POST', 'https://api.phpsandbox.io/v1/servers/server-1/members'],
      ['GET', 'https://api.phpsandbox.io/v1/servers/server-1/members?page=2'],
      ['DELETE', 'https://api.phpsandbox.io/v1/servers/server-1/members/42'],
    ]);
    expect(await requests[1].json()).toEqual({ email: member.email });
  });

  it('lists, creates, refreshes, and deletes server resources', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(Response.json({ data: [serverData()], meta: { currentPage: 2 } }))
      .mockResolvedValueOnce(Response.json({ data: serverData() }))
      .mockResolvedValueOnce(Response.json({ data: serverData() }))
      .mockResolvedValueOnce(Response.json({ data: { deleted: true } }));
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

    const requests = fetch.mock.calls.map(([request]) => request as Request);
    expect(requests.map((request) => [request.method, request.url])).toEqual([
      ['GET', 'https://api.phpsandbox.io/v1/servers?page=2'],
      ['POST', 'https://api.phpsandbox.io/v1/servers'],
      ['GET', 'https://api.phpsandbox.io/v1/servers/server-1'],
      ['DELETE', 'https://api.phpsandbox.io/v1/servers/server-1'],
    ]);
    expect(await requests[1].json()).toEqual({
      name: 'Production server',
      host: 'server.example.test',
      ssh: { user: 'deploy', port: 2222 },
    });
  });

  it('waits for a pending server and rejects a failed server', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(Response.json({ data: serverData('pending') }))
      .mockResolvedValueOnce(Response.json({ data: serverData('connected') }))
      .mockResolvedValueOnce(Response.json({ data: serverData('failed') }));
    const client = PHPSandbox.rest('token', 'https://api.phpsandbox.io/v1', {
      fetch,
    });
    const pending = await client.servers.get('server-1');

    await expect(pending.waitReady({ interval: 0 })).resolves.toMatchObject({
      data: { status: 'connected' },
    });
    await expect(pending.waitReady({ interval: 0 })).rejects.toThrow('Server provisioning failed: server-1');
  });
});
