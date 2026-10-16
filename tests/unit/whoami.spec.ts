import { ok } from 'node:assert/strict';
import { describe, expect, it, vi } from 'vitest';
import { PHPSandbox } from '../../src/index.js';

describe('Whoami', () => {
  it.each(['rest', 'realtime'] as const)('reports the authenticated user through the %s client', async (transport) => {
    const identity = {
      organization: { id: 'organization', name: 'Example team' },
      user: { id: 'user', name: 'Alex' },
      permissions: ['read:notebook'],
    };
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
    const identity = { organization: { id: 'organization', name: 'Example team' }, user: null, permissions: ['read:notebook'] };
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(Response.json({ data: identity }));

    expect(await PHPSandbox.rest('hfp_test', undefined, { fetch }).whoami()).toEqual(identity);
  });

  it.each([
    { organization: { id: 'organization', name: 'Example team' }, user: { id: 'user', name: 'Alex' }, permissions: [12] },
    { organization: { id: 'organization', name: 'Example team' }, user: { id: 'user', name: 123 }, permissions: [] },
    { organizationId: 'organization', userId: 'user', permissions: [] },
    { organization: { id: 'organization' }, user: null, permissions: [] },
    { organization: { id: 'organization', name: 123 }, user: null, permissions: [] },
    { organization: { id: 'organization', name: 'Example team' }, permissions: [] },
  ])('rejects malformed identity responses', async (identity) => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(Response.json({ data: identity }));

    await expect(PHPSandbox.rest('hfp_test', undefined, { fetch }).whoami()).rejects.toThrow('Invalid identity response.');
  });
});
