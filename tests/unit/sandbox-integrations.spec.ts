import { describe, expect, it, vi } from 'vitest';
import { PHPSandbox } from '../../src/index.js';

function createSandboxIntegrationClient() {
  const requests: Array<{ method: string; url: string; body: unknown }> = [];
  const binding = {
    id: 'binding_123',
    integration: {
      id: 'int_123',
      provider: 'github',
      label: 'GitHub',
      createdAt: null,
    },
    effects: ['network'],
  };
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

    return Response.json({ data: request.method === 'GET' && request.url.endsWith('/integrations') ? [binding] : binding });
  }) as unknown as typeof globalThis.fetch;
  const client = PHPSandbox.realtime('token', 'https://api.phpsandbox.io/v1', { fetch });
  const notebook = client.notebook.open({
    id: 'nb_123',
    runtimeUrl: 'https://runtime.example.test',
    gitUrl: 'https://git.example.test',
  });

  return { notebook, requests };
}

describe('Sandbox integration API', () => {
  it('attaches an account integration with explicit effects', async () => {
    const { notebook, requests } = createSandboxIntegrationClient();

    const binding = await notebook.integrations.attach({
      integration: 'int_123',
      effects: ['network'],
    });

    expect(binding.id).toBe('binding_123');
    expect(binding.integration.id).toBe('int_123');
    expect(binding.effects).toEqual(['network']);
    expect(requests[0]).toEqual({
      method: 'POST',
      url: 'https://api.phpsandbox.io/v1/notebook/nb_123/integrations',
      body: { integration: 'int_123', effects: ['network'] },
    });
  });

  it('lists, updates, and detaches sandbox integration resources', async () => {
    const { notebook, requests } = createSandboxIntegrationClient();

    const [binding] = await notebook.integrations.list();
    const updated = await binding.update({ effects: [] });
    await updated.detach();

    expect(requests.map(({ method, url }) => ({ method, url }))).toEqual([
      { method: 'GET', url: 'https://api.phpsandbox.io/v1/notebook/nb_123/integrations' },
      { method: 'PATCH', url: 'https://api.phpsandbox.io/v1/notebook/nb_123/integrations/binding_123' },
      { method: 'DELETE', url: 'https://api.phpsandbox.io/v1/notebook/nb_123/integrations/binding_123' },
    ]);
    expect(requests[1].body).toEqual({ effects: [] });
  });

  it('replaces the selected integration for a provider', async () => {
    const { notebook, requests } = createSandboxIntegrationClient();
    const [binding] = await notebook.integrations.list();

    await binding.update({ integration: 'int_456' });

    expect(requests[1].body).toEqual({ integration: 'int_456' });
  });
});
