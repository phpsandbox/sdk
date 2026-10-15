import { ok } from 'node:assert/strict';
import { describe, expect, it, vi } from 'vitest';
import { PHPSandbox } from '../../src/index.js';

describe('Platform access', () => {
  it('sends the supplied credential to the access endpoint', async () => {
    const access = { organizationId: 'organization', actorId: 'user', permissions: ['read:notebook'] };
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(Response.json({ data: access }));
    const client = PHPSandbox.rest('hfp_test', 'https://api.example.test/v1', { fetch });

    await client.platform.access();

    const request = fetch.mock.calls[0]?.[0];
    ok(request instanceof Request);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(request.headers.get('Authorization')).toBe('Bearer hfp_test');
    expect(request.url).toBe('https://api.example.test/v1/auth/access');
  });

  it('rejects malformed access instead of trusting the wire type', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(Response.json({ data: { organizationId: 'organization', actorId: 'user', permissions: [12] } }));
    await expect(PHPSandbox.rest('hfp_test', undefined, { fetch }).platform.access()).rejects.toThrow('Invalid platform access');
  });

  it('shares with an organization without interpreting it as an email address', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(Response.json({ data: { id: 'server' } }))
      .mockResolvedValueOnce(Response.json({ data: { id: 42, organizationId: 'org', access: 'deployer' } }));
    const server = await PHPSandbox.rest('hfp_test', undefined, { fetch }).servers.get('server');

    await server.shareWithOrganization('org');

    const request = fetch.mock.calls[1]?.[0];
    ok(request instanceof Request);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(request.method).toBe('POST');
    expect(await request.json()).toEqual({ organizationId: 'org' });
  });
});
