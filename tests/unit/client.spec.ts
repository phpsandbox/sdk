import { describe, expect, it, vi } from 'vitest';
import { PHPSandbox } from '../../src/index.js';

function createJsonFetch() {
  const urls: string[] = [];
  const fetch = vi.fn(async (request: Request) => {
    urls.push(request.url);

    return new Response(JSON.stringify({
      data: {
        id: 'abc',
        runtimeUrl: 'https://runtime.example.test',
        gitUrl: 'https://git.example.test',
      },
    }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
      },
    });
  }) as unknown as typeof globalThis.fetch;

  return { fetch, urls };
}

describe('PHPSandbox', () => {
  it('handles redirects manually for authenticated requests', async () => {
    const requests: Request[] = [];
    const fetch = vi.fn(async (request: Request) => {
      requests.push(request);
      return Response.json({
        data: {
          id: 'abc',
          runtimeUrl: 'https://runtime.example.test',
          gitUrl: 'https://git.example.test',
        },
      });
    }) as unknown as typeof globalThis.fetch;
    const client = PHPSandbox.realtime('private-api-key', undefined, { fetch });

    await client.notebook.get('abc');
    expect(requests[0].redirect).toBe('manual');
    expect(requests[0].headers.get('authorization')).toBe('Bearer private-api-key');
  });

  it.each([
    ['https://api.phpsandbox.io', 'https://api.phpsandbox.io/v1/notebook/abc'],
    ['https://api.phpsandbox.io/', 'https://api.phpsandbox.io/v1/notebook/abc'],
    ['https://api.phpsandbox.io/v1', 'https://api.phpsandbox.io/v1/notebook/abc'],
    ['https://api.phpsandbox.io/v1/', 'https://api.phpsandbox.io/v1/notebook/abc'],
  ])('normalizes API base URL %s', async (baseUrl, expectedUrl) => {
    const { fetch, urls } = createJsonFetch();
    const client = PHPSandbox.realtime('token', baseUrl, { fetch });

    await client.notebook.get('abc');

    expect(urls).toEqual([expectedUrl]);
  });

});
