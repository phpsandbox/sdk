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

describe('server invitations', () => {
  it('declines using proof in the body and propagates API rejection', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(Response.json({ data: { id: 'invite-1', status: 'declined' } }))
      .mockResolvedValueOnce(Response.json({ error: { status: 409, code: 'Conflict', message: 'Invitation expired' } }, { status: 409 }));
    const client = PHPSandbox.rest('token', 'https://api.phpsandbox.io/v1', { fetch });

    await expect(client.servers.invitations.decline('invite-1', 'private-proof')).resolves.toMatchObject({ status: 'declined' });
    await expect(client.servers.invitations.accept('invite-1', 'private-proof')).rejects.toMatchObject({ status: 409 });

    const request = new Request(fetch.mock.calls[0][0]);
    expect(request.url).toBe('https://api.phpsandbox.io/v1/server-invitations/invite-1/decline');
    expect(request.method).toBe('POST');
    expect(await request.json()).toEqual({ token: 'private-proof' });
  });

  it('uses one resource across creation, listing, inspection, acceptance, resend, and cancellation without exposing proof', async () => {
    const invitation = {
      id: 'invite-1',
      serverId: 'server-1',
      serverName: 'Production',
      email: 'alex@example.test',
      status: 'pending',
      expiresAt: '2030-01-01T00:00:00Z',
      createdAt: '2026-01-01T00:00:00Z',
    };
    const fetch = vi.fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(Response.json({ data: serverData() }))
      .mockResolvedValueOnce(Response.json({ data: invitation }))
      .mockResolvedValueOnce(Response.json({ data: [invitation] }))
      .mockResolvedValueOnce(Response.json({ data: invitation }))
      .mockResolvedValueOnce(Response.json({ data: { ...invitation, status: 'accepted' } }))
      .mockResolvedValueOnce(Response.json({ data: invitation }))
      .mockResolvedValueOnce(Response.json({ data: { ...invitation, status: 'cancelled' } }));
    const client = PHPSandbox.rest('token', 'https://api.phpsandbox.io/v1', { fetch });
    const server = await client.servers.get('server-1');

    await expect(server.invite(invitation.email, { requestId: 'request-1' })).resolves.toEqual(invitation);
    await expect(server.invitations()).resolves.toMatchObject({ data: [invitation] });
    await client.servers.invitations.inspect('invite-1', 'private-proof');
    await expect(client.servers.invitations.accept('invite-1', 'private-proof')).resolves.toMatchObject({ status: 'accepted' });
    await server.resendInvitation('invite-1');
    await server.cancelInvitation('invite-1');

    const requests = fetch.mock.calls.map(([request]) => new Request(request));
    expect(requests.map((request) => request.url)).toEqual([
      'https://api.phpsandbox.io/v1/servers/server-1',
      'https://api.phpsandbox.io/v1/servers/server-1/invitations',
      'https://api.phpsandbox.io/v1/servers/server-1/invitations',
      'https://api.phpsandbox.io/v1/server-invitations/invite-1/inspect',
      'https://api.phpsandbox.io/v1/server-invitations/invite-1/accept',
      'https://api.phpsandbox.io/v1/servers/server-1/invitations/invite-1/resend',
      'https://api.phpsandbox.io/v1/servers/server-1/invitations/invite-1',
    ]);
    expect(requests.map((request) => request.method)).toEqual(['GET', 'POST', 'GET', 'POST', 'POST', 'POST', 'DELETE']);
    expect(await requests[1].json()).toEqual({ email: invitation.email, requestId: 'request-1' });
    expect(await requests[4].json()).toEqual({ token: 'private-proof' });
  });
});

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
