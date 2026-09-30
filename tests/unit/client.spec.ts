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

  it.each([
    ['HTML', '<html>Bad Gateway</html>'],
    ['empty', ''],
    ['non-canonical JSON', JSON.stringify({ message: 'Too many requests.' })],
    ['unsupported code', JSON.stringify({ error: { status: 502, code: 'Unexpected', message: 'Failure.' } })],
  ])('preserves HTTP diagnostics for %s errors', async (_label, body) => {
    const response = new Response(body, { status: 502, statusText: 'Bad Gateway' });
    const fetch = vi.fn(async () => response) as unknown as typeof globalThis.fetch;
    const client = PHPSandbox.realtime('private-api-key', undefined, { fetch });
    const notebook = client.notebook.open({ id: 'abc', runtimeUrl: 'https://runtime.example.test' });

    await expect(notebook.preview.disable()).rejects.toMatchObject({
      name: 'TransportError',
      code: 'InvalidResponse',
      message: 'PHPSandbox API returned an invalid error response (HTTP 502).',
      cause: response,
      response: { status: 502, statusText: 'Bad Gateway', body },
    });
  });

  it('bounds malformed response excerpts', async () => {
    const fetch = vi.fn(async () => new Response('x'.repeat(5000), { status: 503 })) as unknown as typeof globalThis.fetch;
    const client = PHPSandbox.realtime('token', undefined, { fetch });

    await expect(client.notebook.get('abc')).rejects.toMatchObject({
      response: { status: 503, body: 'x'.repeat(4096) },
    });
  });

  it('preserves canonical API errors', async () => {
    const fetch = vi.fn(async () => Response.json({
      error: { status: 429, code: 'RateLimited', message: 'Too many requests.', details: { retryAfter: 60 } },
    }, { status: 429 })) as unknown as typeof globalThis.fetch;
    const client = PHPSandbox.realtime('token', undefined, { fetch });

    await expect(client.notebook.get('abc')).rejects.toMatchObject({
      name: 'RemoteError',
      source: 'core',
      status: 429,
      code: 'RateLimited',
      message: 'Too many requests.',
      details: { retryAfter: 60 },
    });
  });

});
