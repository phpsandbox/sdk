import { describe, expect, it, vi } from 'vitest';
import { PHPSandbox } from '../../src/index.js';

describe('Notebook secrets', () => {
  it('normalizes writes and scopes reads and deletes by environment', async () => {
    const requests: Array<{ method: string; url: string; body: unknown }> = [];
    const fetch = vi.fn(async (request: Request) => {
      const text = await request.text();
      requests.push({
        method: request.method,
        url: request.url,
        body: text === '' ? undefined : JSON.parse(text),
      });

      return Response.json({ data: request.method === 'GET' || text.startsWith('{"secrets"') ? [] : {
        uuid: 'secret-1',
        name: 'API_KEY',
        type: 'environment_variable',
        environment: 'production',
        createdAt: null,
        updatedAt: null,
      } });
    }) as unknown as typeof globalThis.fetch;
    const notebook = PHPSandbox.rest('token', 'https://api.phpsandbox.io/v1', { fetch }).notebook.open({
      id: 'notebook-1',
      runtimeUrl: 'https://runtime.example.test?ticket=test-ticket',
      gitUrl: 'https://git.example.test/notebook-1.git',
    });

    await notebook.secrets.list({ environment: 'production' });
    await notebook.secrets.set('API_KEY', 'value');
    await notebook.secrets.set('TOKEN', {
      value: 'credential',
      type: 'credential',
      environment: 'development',
    });
    await notebook.secrets.setMany({
      APP_NAME: 'PHPSandbox',
      APP_ENV: { value: 'production', environment: 'production' },
    });
    await notebook.secrets.delete('API/KEY', { environment: 'production' });

    expect(requests).toEqual([
      {
        method: 'GET',
        url: 'https://api.phpsandbox.io/v1/notebook/notebook-1/secrets?environment=production',
        body: undefined,
      },
      {
        method: 'PUT',
        url: 'https://api.phpsandbox.io/v1/notebook/notebook-1/secrets',
        body: { name: 'API_KEY', value: 'value' },
      },
      {
        method: 'PUT',
        url: 'https://api.phpsandbox.io/v1/notebook/notebook-1/secrets',
        body: {
          name: 'TOKEN',
          value: 'credential',
          type: 'credential',
          environment: 'development',
        },
      },
      {
        method: 'PUT',
        url: 'https://api.phpsandbox.io/v1/notebook/notebook-1/secrets',
        body: {
          secrets: [
            { name: 'APP_NAME', value: 'PHPSandbox' },
            { name: 'APP_ENV', value: 'production', environment: 'production' },
          ],
        },
      },
      {
        method: 'DELETE',
        url: 'https://api.phpsandbox.io/v1/notebook/notebook-1/secrets/API%2FKEY?environment=production',
        body: undefined,
      },
    ]);
  });
});
