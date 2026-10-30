import { describe, expect, it, vi } from 'vitest';
import { PHPSandbox, type ServerData, type ServerInvitationData } from '../../src/index.js';

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
  it('uses one configured API endpoint and credential for resource and invitation operations', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(Response.json({ data: serverData() }))
      .mockResolvedValueOnce(Response.json({ data: { id: 'invitation', status: 'pending' } }))
      .mockResolvedValueOnce(
        Response.json({ error: { status: 403, code: 'PermissionDenied', message: 'Administrator required' } }, { status: 403 })
      );
    const client = PHPSandbox.rest('platform-token', 'https://resources.example.test/v1', {
      fetch,
    });
    const server = await client.servers.get('server-1');

    await server.share({ email: 'alex@example.test', requestId: 'stable-request' });
    await expect(client.servers.acceptInvitation('invitation', 'proof')).rejects.toMatchObject({
      status: 403,
      source: 'platform',
    });

    const requests = fetch.mock.calls.map(([input]) => new Request(input));
    expect(requests.map((request) => request.url)).toEqual([
      'https://resources.example.test/v1/servers/server-1',
      'https://resources.example.test/v1/platform/servers/server-1/invitations',
      'https://resources.example.test/v1/platform/server-invitations/invitation/accept',
    ]);
    expect(requests.map((request) => request.headers.get('Authorization'))).toEqual([
      'Bearer platform-token',
      'Bearer platform-token',
      'Bearer platform-token',
    ]);
  });

  it('declines using proof in the body and propagates API rejection', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(Response.json({ data: { id: 'invite-1', status: 'declined' } }))
      .mockResolvedValueOnce(
        Response.json({ error: { status: 409, code: 'Conflict', message: 'Invitation expired' } }, { status: 409 })
      );
    const client = PHPSandbox.rest('token', 'https://api.phpsandbox.io/v1', { fetch });

    await expect(client.servers.declineInvitation('invite-1', 'private-proof')).resolves.toMatchObject({ status: 'declined' });
    await expect(client.servers.acceptInvitation('invite-1', 'private-proof')).rejects.toMatchObject({ status: 409 });

    const request = new Request(fetch.mock.calls[0][0]);
    expect(request.url).toBe('https://api.phpsandbox.io/v1/platform/server-invitations/invite-1/decline');
    expect(request.method).toBe('POST');
    expect(await request.json()).toEqual({ token: 'private-proof' });
  });

  it('uses one resource across creation, listing, inspection, acceptance, resend, and cancellation without exposing proof', async () => {
    const invitation = {
      id: 'invite-1',
      recipientOrganizationId: null,
      serverId: 'server-1',
      serverName: 'Production',
      email: 'alex@example.test',
      status: 'pending',
      expiresAt: '2030-01-01T00:00:00Z',
      createdAt: '2026-01-01T00:00:00Z',
    } satisfies ServerInvitationData;
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(Response.json({ data: serverData() }))
      .mockResolvedValueOnce(Response.json({ data: invitation }))
      .mockResolvedValueOnce(Response.json({ data: [invitation] }))
      .mockResolvedValueOnce(Response.json({ data: invitation }))
      .mockResolvedValueOnce(Response.json({ data: { ...invitation, status: 'accepted' } }))
      .mockResolvedValueOnce(Response.json({ data: invitation }))
      .mockResolvedValueOnce(Response.json({ data: { ...invitation, status: 'cancelled' } }));
    const client = PHPSandbox.rest('token', 'https://api.phpsandbox.io/v1', { fetch });
    const server = await client.servers.get('server-1');

    await expect(server.share({ email: invitation.email, requestId: 'request-1' })).resolves.toEqual(invitation);
    await expect(server.invitations()).resolves.toMatchObject({ data: [invitation] });
    await client.servers.inspectInvitation('invite-1', 'private-proof');
    await expect(client.servers.acceptInvitation('invite-1', 'private-proof')).resolves.toMatchObject({ status: 'accepted' });
    await server.resendInvitation('invite-1');
    await server.cancelInvitation('invite-1');

    const requests = fetch.mock.calls.map(([request]) => new Request(request));
    expect(requests.map((request) => request.url)).toEqual([
      'https://api.phpsandbox.io/v1/servers/server-1',
      'https://api.phpsandbox.io/v1/platform/servers/server-1/invitations',
      'https://api.phpsandbox.io/v1/platform/servers/server-1/invitations',
      'https://api.phpsandbox.io/v1/platform/server-invitations/invite-1/inspect',
      'https://api.phpsandbox.io/v1/platform/server-invitations/invite-1/accept',
      'https://api.phpsandbox.io/v1/platform/servers/server-1/invitations/invite-1/resend',
      'https://api.phpsandbox.io/v1/platform/servers/server-1/invitations/invite-1',
    ]);
    expect(requests.map((request) => request.method)).toEqual(['GET', 'POST', 'GET', 'POST', 'POST', 'POST', 'DELETE']);
    expect(await requests[1].json()).toEqual({ email: invitation.email, requestId: 'request-1' });
    expect(await requests[4].json()).toEqual({ token: 'private-proof' });
  });
});

describe('Server API', () => {
  it('shares one server with an existing workspace, lists members, and revokes access', async () => {
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
    await expect(server.share({ organizationId: 'workspace-1' })).resolves.toEqual(member);
    await expect(server.members({ page: 2 })).resolves.toMatchObject({ data: [member], meta: { currentPage: 2 } });
    await server.revokeAccess(member.id);
    const requests = fetch.mock.calls.map(([request]) => request as Request);
    expect(requests.map((request) => [request.method, request.url])).toEqual([
      ['GET', 'https://api.phpsandbox.io/v1/servers/server-1'],
      ['POST', 'https://api.phpsandbox.io/v1/servers/server-1/members'],
      ['GET', 'https://api.phpsandbox.io/v1/servers/server-1/members?page=2'],
      ['DELETE', 'https://api.phpsandbox.io/v1/servers/server-1/members/42'],
    ]);
    expect(await requests[1].json()).toEqual({ organizationId: 'workspace-1' });
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

it('requests an exact agent release with the same idempotency identity across retries', async () => {
  const operation = {
    id: '49d3ca1d-40cd-44be-826a-a87581b3fd1b',
    targetVersion: 'v0.3.2',
    status: 'requested',
    updatedAt: '2026-10-30T00:00:00Z',
  };
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockResolvedValueOnce(Response.json({ data: serverData() }))
    .mockResolvedValueOnce(Response.json({ data: operation }, { status: 202 }))
    .mockResolvedValueOnce(Response.json({ data: operation }, { status: 202 }));
  const client = PHPSandbox.rest('token', 'https://api.phpsandbox.io/v1', { fetch });
  const server = await client.servers.get('server-1');
  const input = { requestId: '49d3ca1d-40cd-44be-826a-a87581b3fd1b', targetVersion: 'v0.3.2' };

  await expect(server.updateAgent(input)).resolves.toEqual(operation);
  await expect(server.updateAgent(input)).resolves.toEqual(operation);

  const requests = fetch.mock.calls.slice(1).map(([request]) => new Request(request));
  expect(requests.map((request) => [request.method, request.url])).toEqual([
    ['POST', 'https://api.phpsandbox.io/v1/servers/server-1/agent/updates'],
    ['POST', 'https://api.phpsandbox.io/v1/servers/server-1/agent/updates'],
  ]);
  expect(await Promise.all(requests.map((request) => request.json()))).toEqual([input, input]);
});

it('keeps managed installation consent separate from the normal installation command', async () => {
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockResolvedValueOnce(Response.json({ data: serverData() }))
    .mockResolvedValueOnce(Response.json({ data: { installCommand: 'install' } }))
    .mockResolvedValueOnce(Response.json({ data: { installCommand: 'install --managed-updates' } }));
  const client = PHPSandbox.rest('token', 'https://api.phpsandbox.io/v1', { fetch });
  const server = await client.servers.get('server-1');

  await expect(server.installation()).resolves.toEqual({ installCommand: 'install' });
  await expect(server.installation({ managedUpdates: true })).resolves.toEqual({ installCommand: 'install --managed-updates' });

  expect(fetch.mock.calls.slice(1).map(([request]) => new Request(request).url)).toEqual([
    'https://api.phpsandbox.io/v1/servers/server-1/installation',
    'https://api.phpsandbox.io/v1/servers/server-1/installation?managedUpdates=1',
  ]);
});
