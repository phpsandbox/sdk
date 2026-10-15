import { describe, expect, it, vi } from 'vitest';
import { PHPSandbox } from '../../src/index.js';

describe('Platform access', () => {
  it('uses the supplied credential and validates the access contract', async () => {
    const access = { organizationId: 'organization', actorId: 'user', permissions: ['read:notebook'] };
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(Response.json({ data: access }));
    const client = PHPSandbox.rest('hfp_test', 'https://api.example.test/v1', { fetch });
    await expect(client.platform.access()).resolves.toEqual(access);
    const request = fetch.mock.calls[0]?.[0];
    expect(request).toBeInstanceOf(Request);
    if (request instanceof Request) {
      expect(request.headers.get('Authorization')).toBe('Bearer hfp_test');
      expect(request.url).toBe('https://api.example.test/v1/auth/access');
    }
  });

  it('rejects malformed access instead of trusting the wire type', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(Response.json({ data: { permissions: [12] } }));
    await expect(PHPSandbox.rest('hfp_test', undefined, { fetch }).platform.access()).rejects.toThrow('Invalid platform access');
  });

  it('shares with an organization without interpreting it as an email address', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(Response.json({ data: { id: 'server' } }))
      .mockResolvedValueOnce(Response.json({ data: { id: 42, organizationId: 'org', access: 'deployer' } }));
    const server = await PHPSandbox.rest('hfp_test', undefined, { fetch }).servers.get('server');
    await expect(server.shareWithOrganization('org')).resolves.toMatchObject({ organizationId: 'org' });
    const request = fetch.mock.calls[1]?.[0];
    if (!(request instanceof Request)) {
      throw new Error('Missing share request');
    }
    expect(await request.json()).toEqual({ organizationId: 'org' });
  });
});
