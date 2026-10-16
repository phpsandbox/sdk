import { ok } from 'node:assert/strict';
import { describe, expect, it, vi } from 'vitest';
import { PHPSandbox } from '../../src/index.js';

describe('Organization server sharing', () => {
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
