import { describe, expect, it, vi } from 'vitest';
import { PHPSandbox } from '../../src/index.js';

describe('sandbox.feedback', () => {
  it('preserves author and context and sends the same idempotency key on retries', async () => {
    const requests: Request[] = [];
    const fetch = vi.fn(async (request: Request) => {
      requests.push(request);
      return Response.json({ data: { id: 'feedback-1' } });
    });
    const client = PHPSandbox.rest('standard-token', 'https://api.example.test/v1', { fetch });
    const input = {
      type: 'bug' as const,
      message: 'Save failed',
      author: { externalId: 'user-42', name: 'Example User', email: 'user@example.test' },
      context: {
        url: 'https://app.example.test/settings',
        userAgent: 'Example browser',
        imageUrls: ['https://app.example.test/screenshot.png'],
      },
      metadata: { source: 'product-feedback' },
    };

    await client.feedback.forProject('project-1').submit(input, { idempotencyKey: 'submission-1' });
    await client.feedback.forProject('project-1').submit(input, { idempotencyKey: 'submission-1' });

    expect(requests).toHaveLength(2);
    for (const request of requests) {
      expect(request.url).toBe('https://api.example.test/v1/platform/projects/project-1/feedback');
      expect(request.headers.get('authorization')).toBe('Bearer standard-token');
      expect(request.headers.get('content-type')).toBe('application/json');
      expect(request.headers.get('idempotency-key')).toBe('submission-1');
      expect(await request.json()).toEqual(input);
    }
  });

  it('uses one notebook-scoped interface for configuration, ingestion, and management', async () => {
    const requests: Array<{ method: string; url: string; body: unknown }> = [];
    const fetch = vi.fn(async (request: Request) => {
      expect(request.headers.get('authorization')).toBe('Bearer token');
      const text = await request.text();
      requests.push({
        method: request.method,
        url: request.url,
        body: text === '' ? undefined : JSON.parse(text),
      });

      if (request.method === 'GET' && request.url.endsWith('/notebook/sandbox-1')) {
        return Response.json({
          data: {
            id: 'sandbox-1',
            runtimeUrl: 'https://runtime.example.test/actions?ticket=test-ticket',
            gitUrl: 'https://git.example.test/sandbox-1.git',
          },
        });
      }

      if (request.url.includes('?')) {
        return Response.json({ data: [], meta: {} });
      }

      return Response.json({ data: { id: 'feedback-1', status: 'open' } });
    }) as unknown as typeof globalThis.fetch;
    const client = PHPSandbox.rest('token', 'https://api.phpsandbox.io/v1', { fetch });
    const sandbox = await client.notebook.get('sandbox-1');

    await sandbox.feedback.configure({
      widget: { targets: ['preview', 'publication'], types: ['bug', 'suggestion'] },
    });
    await sandbox.feedback.configuration();
    await sandbox.feedback.submit({
      type: 'bug',
      message: 'Save failed',
      author: { externalId: 'user-42' },
    });
    await sandbox.feedback.list({ status: 'open', page: 2 });
    await sandbox.feedback.get('feedback-1');
    await sandbox.feedback.update('feedback-1', { status: 'resolved' });

    expect(requests.slice(1)).toEqual([
      {
        method: 'PUT',
        url: 'https://api.phpsandbox.io/v1/platform/projects/sandbox-1/feedback/configuration',
        body: { widget: { targets: ['preview', 'publication'], types: ['bug', 'suggestion'] } },
      },
      {
        method: 'GET',
        url: 'https://api.phpsandbox.io/v1/platform/projects/sandbox-1/feedback/configuration',
        body: undefined,
      },
      {
        method: 'POST',
        url: 'https://api.phpsandbox.io/v1/platform/projects/sandbox-1/feedback',
        body: { type: 'bug', message: 'Save failed', author: { externalId: 'user-42' } },
      },
      {
        method: 'GET',
        url: 'https://api.phpsandbox.io/v1/platform/projects/sandbox-1/feedback?status=open&page=2',
        body: undefined,
      },
      {
        method: 'GET',
        url: 'https://api.phpsandbox.io/v1/platform/projects/sandbox-1/feedback/feedback-1',
        body: undefined,
      },
      {
        method: 'PATCH',
        url: 'https://api.phpsandbox.io/v1/platform/projects/sandbox-1/feedback/feedback-1',
        body: { status: 'resolved' },
      },
    ]);
  });
  it('addresses a project directly using the existing token without loading a notebook', async () => {
    const requests: Request[] = [];
    const fetch = vi.fn(async (request: Request) => {
      requests.push(request);
      return Response.json({ data: [] });
    });
    const client = PHPSandbox.rest('standard-token', 'https://api.example.test/v1', { fetch });

    await client.feedback.forProject('project/1').list();
    await client.feedback.forNotebook('notebook/1').list();

    expect(requests.map((request) => request.url)).toEqual([
      'https://api.example.test/v1/platform/projects/project%2F1/feedback',
      'https://api.example.test/v1/platform/projects/notebook%2F1/feedback',
    ]);
    expect(requests.map((request) => request.headers.get('authorization'))).toEqual([
      'Bearer standard-token',
      'Bearer standard-token',
    ]);
  });
});
