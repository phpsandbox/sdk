import { describe, expect, it, vi } from 'vitest';
import { PHPSandbox } from '../../src/index.js';

describe('Notebook API', () => {
  it('inspects an import before notebook creation', async () => {
    const requests: Request[] = [];
    const inspection = {
      supported: true,
      repository: 'phpsandbox/core',
      branch: 'main',
      ref: 'a'.repeat(40),
      framework: 'laravel' as const,
      template: 'laravel-react',
      reason: null,
      requiredSecrets: [
        { name: 'RUNTIME_SOURCE_ENROLLMENT_ACCESS_CLIENT_ID', description: 'Cloudflare Access client ID.' },
      ],
    };
    const fetch = vi.fn(async (request: Request) => {
      requests.push(request);
      return Response.json({ data: inspection });
    }) as unknown as typeof globalThis.fetch;
    const client = PHPSandbox.rest('token', 'https://api.phpsandbox.io/v1', { fetch });

    await expect(client.notebook.inspectImport({
      provider: 'github',
      repo: 'phpsandbox/core',
      branch: 'main',
      auth: { accessToken: 'github-token' },
    })).resolves.toEqual(inspection);

    expect(new URL(requests[0].url).pathname).toBe('/v1/notebook/imports/inspect');
    await expect(requests[0].json()).resolves.toEqual({
      provider: 'github',
      repo: 'phpsandbox/core',
      branch: 'main',
      auth: { accessToken: 'github-token' },
    });
  });

  it('sends the inspected ref and creation-time secrets', async () => {
    const requests: Request[] = [];
    const fetch = vi.fn(async (request: Request) => {
      requests.push(request);
      return Response.json({
        data: {
          id: 'notebook-1',
          runtimeUrl: 'https://runtime.example.test?ticket=test-ticket',
          gitUrl: 'https://git.example.test/notebook-1.git',
        },
      });
    }) as unknown as typeof globalThis.fetch;
    const client = PHPSandbox.rest('token', 'https://api.phpsandbox.io/v1', { fetch });

    await client.notebook.create('laravel-react', {
      title: 'Core',
      visibility: 'private',
      import: {
        provider: 'github',
        repo: 'phpsandbox/core',
        branch: 'main',
        ref: 'a'.repeat(40),
        auth: { accessToken: 'github-token' },
      },
      secrets: [{ name: 'RUNTIME_SOURCE_ENROLLMENT_ACCESS_CLIENT_ID', value: 'client-id' }],
    });

    await expect(requests[0].json()).resolves.toMatchObject({
      template: 'laravel-react',
      import: { ref: 'a'.repeat(40) },
      secrets: [{ name: 'RUNTIME_SOURCE_ENROLLMENT_ACCESS_CLIENT_ID', value: 'client-id' }],
    });
  });
});
