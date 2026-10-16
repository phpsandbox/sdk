import { ok } from 'node:assert/strict';
import { describe, expect, it, vi } from 'vitest';
import { PHPSandbox } from '../../src/index.js';

describe('Whoami', () => {
  it.each(['rest', 'realtime'] as const)('reports the authenticated user through the %s client', async (transport) => {
    const identity = { organizationId: 'organization', userId: 'user', permissions: ['read:notebook'] };
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(Response.json({ data: identity }));
    const client = PHPSandbox[transport]('hfp_test', 'https://api.example.test/v1', { fetch });

    const result = await client.whoami();

    expect(result).toEqual(identity);
    const request = fetch.mock.calls[0]?.[0];
    ok(request instanceof Request);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(request.headers.get('Authorization')).toBe('Bearer hfp_test');
    expect(request.url).toBe('https://api.example.test/v1/auth/whoami');
  });

  it('reports organization credentials without attributing them to a user', async () => {
    const identity = { organizationId: 'organization', userId: null, permissions: ['read:notebook'] };
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(Response.json({ data: identity }));

    expect(await PHPSandbox.rest('hfp_test', undefined, { fetch }).whoami()).toEqual(identity);
  });

  it.each([
    { organizationId: 'organization', userId: 'user', permissions: [12] },
    { organizationId: 'organization', userId: 123, permissions: [] },
    { organizationId: 'organization', actorId: 'user', permissions: [] },
  ])('rejects malformed identity responses', async (identity) => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(Response.json({ data: identity }));

    await expect(PHPSandbox.rest('hfp_test', undefined, { fetch }).whoami()).rejects.toThrow('Invalid identity response.');
  });
});
