import { describe, expect, test, vi } from 'vitest';
import {
  createPublicationResourceLease,
  isExpiredResourceLease,
  PublicationResourceLeaseRegistry,
} from '../support/resource-leases.js';

const github = { owner: 'phpsandbox', token: 'secret-token' };
const registryEnvironment = { branch: 'smoke-resource-registry', repository: 'phpsandbox/fixtures' };

describe('publication resource leases', () => {
  test('uses immutable workflow identity and an exact optional server name', () => {
    expect(createPublicationResourceLease({
      notebookId: 'notebook-1',
      provider: 'ssh-server',
      runAttempt: '2',
      runId: '12345',
      serverName: 'SDK Rook 12345.2',
      timestamp: new Date('2026-08-30T00:00:00.000Z'),
    })).toEqual({
      createdAt: '2026-08-30T00:00:00.000Z',
      notebookId: 'notebook-1',
      provider: 'ssh-server',
      runAttempt: '2',
      runId: '12345',
      server: { name: 'SDK Rook 12345.2' },
      version: 1,
    });
  });

  test('expires a lease only after the configured age', () => {
    const lease = createPublicationResourceLease({
      notebookId: 'notebook-1',
      provider: 'laravel-cloud',
      runAttempt: '1',
      runId: '12345',
      timestamp: new Date('2026-08-30T00:00:00.000Z'),
    });

    expect(isExpiredResourceLease(lease, 6, new Date('2026-08-30T05:59:59.999Z'))).toBe(false);
    expect(isExpiredResourceLease(lease, 6, new Date('2026-08-30T06:00:00.000Z'))).toBe(true);
  });

  test('writes leases to the provider directory without disclosing the token', async () => {
    const fetchImplementation = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      content: { sha: 'lease-sha' },
    }), { status: 201 }));
    const registry = new PublicationResourceLeaseRegistry(github, registryEnvironment, fetchImplementation);
    const lease = createPublicationResourceLease({
      notebookId: 'notebook-1',
      provider: 'cloudflare-containers',
      runAttempt: '1',
      runId: '12345',
      timestamp: new Date('2026-08-30T00:00:00.000Z'),
    });

    const stored = await registry.create(lease);

    expect(stored).toMatchObject({
      path: '.sdk-smoke/resource-leases/cloudflare-containers/12345.1.json',
      sha: 'lease-sha',
    });
    const [url, request] = fetchImplementation.mock.calls[0]!;
    expect(String(url)).toContain('/cloudflare-containers/12345.1.json');
    expect(request?.headers).toMatchObject({ Authorization: 'Bearer secret-token' });
    expect(JSON.parse(String(request?.body))).toMatchObject({ branch: 'smoke-resource-registry' });
    expect(request?.body).not.toContain('secret-token');
  });
});
