import { describe, expect, it, vi } from 'vitest';
import { PHPSandbox } from '../../src/index.js';

function createPreviewClient(data: unknown = { enabled: false }) {
  const requests: Array<{ method: string; url: string; body: unknown }> = [];
  const fetch = vi.fn(async (request: Request) => {
    const text = await request.text();
    requests.push({
      method: request.method,
      url: request.url,
      body: text === '' ? undefined : JSON.parse(text),
    });

    return Response.json({ data });
  }) as unknown as typeof globalThis.fetch;

  return {
    client: PHPSandbox.realtime('token', 'https://api.phpsandbox.io/v1', { fetch }),
    requests,
  };
}

describe('Notebook preview API', () => {
  it('preserves separate clean and opaque access URLs for access, sessions, and handoffs', async () => {
    const data = {
      enabled: true,
      token: 'opaque-token',
      previewSessionId: 'ps_session',
      handoffId: 'ph_handoff',
      expiresAt: '2026-10-01T12:00:00Z',
      url: 'https://notebook-123.ciroue.test/dashboard?tab=security#profile',
      accessUrl: 'https://access.example.test/opaque-grant',
    };
    const { client } = createPreviewClient(data);
    const notebook = client.notebook.open({
      id: 'notebook-123',
      runtimeUrl: 'https://runtime.example.test',
      gitUrl: 'https://git.example.test',
    });
    expect(await notebook.preview.get(data.url)).toEqual(data);
    expect(await notebook.preview.createSession({ url: data.url })).toEqual(data);
    expect(await notebook.preview.createHandoff({ previewSessionId: 'ps_source', url: data.url })).toEqual(data);
  });

  it('passes the preview URL when resolving access', async () => {
    const { client, requests } = createPreviewClient();

    const notebook = client.notebook.open({
      id: 'notebook-123',
      runtimeUrl: 'https://runtime.example.test',
      gitUrl: 'https://git.example.test',
    });
    await notebook.preview.get('https://notebook-123.ciroue.test/settings/profile?tab=security');

    expect(requests).toEqual([
      {
        method: 'GET',
        url:
          'https://api.phpsandbox.io/v1/notebook/notebook-123/preview?url=https%3A%2F%2Fnotebook-123.ciroue.test%2Fsettings%2Fprofile%3Ftab%3Dsecurity',
        body: undefined,
      },
    ]);
  });

  it('passes the preview URL when creating sessions and handoffs', async () => {
    const { client, requests } = createPreviewClient();
    const url = 'https://notebook-123.ciroue.test/settings/profile';

    const notebook = client.notebook.open({
      id: 'notebook-123',
      runtimeUrl: 'https://runtime.example.test',
      gitUrl: 'https://git.example.test',
    });
    await notebook.preview.createSession({ url });
    await notebook.preview.createHandoff({
      previewSessionId: 'ps_source',
      expiresInSeconds: 900,
      url,
    });

    expect(requests).toEqual([
      {
        method: 'POST',
        url: 'https://api.phpsandbox.io/v1/notebook/notebook-123/preview/session',
        body: { url },
      },
      {
        method: 'POST',
        url: 'https://api.phpsandbox.io/v1/notebook/notebook-123/preview/handoff',
        body: { previewSessionId: 'ps_source', expiresInSeconds: 900, url },
      },
    ]);
  });
});
