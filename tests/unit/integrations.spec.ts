import { describe, expect, it, vi } from 'vitest';
import { PHPSandbox } from '../../src/index.js';

function createIntegrationClient() {
  const requests: Array<{ method: string; url: string; body: unknown }> = [];
  const fetch = vi.fn(async (request: Request) => {
    const text = await request.text();
    requests.push({
      method: request.method,
      url: request.url,
      body: text === '' ? undefined : JSON.parse(text),
    });

    if (request.method === 'DELETE') {
      return new Response(null, { status: 204 });
    }

    return Response.json({ data: request.method === 'GET' && request.url.endsWith('/integrations') ? [] : {
      id: 'int_123',
      provider: 'github',
      label: 'Helfer GitHub',
      createdAt: null,
    } });
  }) as unknown as typeof globalThis.fetch;

  return {
    client: PHPSandbox.realtime('token', 'https://api.phpsandbox.io/v1', { fetch }),
    requests,
  };
}

describe('Integration API', () => {
  it('links opaque token authorization and returns resource instances', async () => {
    const { client, requests } = createIntegrationClient();
    const input = {
      provider: 'github' as const,
      label: 'Helfer GitHub',
      authorization: {
        type: 'token' as const,
        token: 'possibly-invalid-token',
      },
    };

    const integration = await client.integrations.link(input);

    expect(integration.id).toBe('int_123');
    expect(integration.provider).toBe('github');
    await expect(client.integrations.list()).resolves.toEqual([]);

    expect(requests).toEqual([
      {
        method: 'POST',
        url: 'https://api.phpsandbox.io/v1/integrations',
        body: input,
      },
      {
        method: 'GET',
        url: 'https://api.phpsandbox.io/v1/integrations',
        body: undefined,
      },
    ]);
  });

  it('gets and unlinks an integration reference', async () => {
    const { client, requests } = createIntegrationClient();

    const integration = await client.integrations.get('integration/123');
    await integration.unlink();

    expect(requests.map(({ method, url }) => ({ method, url }))).toEqual([
      { method: 'GET', url: 'https://api.phpsandbox.io/v1/integrations/integration%2F123' },
      { method: 'DELETE', url: 'https://api.phpsandbox.io/v1/integrations/int_123' },
    ]);
  });

  it('updates authorization and labels through the resource', async () => {
    const { client, requests } = createIntegrationClient();
    const integration = await client.integrations.get('int_123');

    const updated = await integration.update({
      label: 'Engineering GitHub',
      authorization: { type: 'token', token: 'replacement-token' },
    });
    await updated.unlink();

    expect(requests.slice(1)).toEqual([
      {
        method: 'PATCH',
        url: 'https://api.phpsandbox.io/v1/integrations/int_123',
        body: {
          label: 'Engineering GitHub',
          authorization: { type: 'token', token: 'replacement-token' },
        },
      },
      {
        method: 'DELETE',
        url: 'https://api.phpsandbox.io/v1/integrations/int_123',
        body: undefined,
      },
    ]);
  });
});
