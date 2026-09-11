import { describe, expect, it, vi } from 'vitest';
import { PHPSandbox } from '../../src/index.js';

describe('sandbox.feedback', () => {
  it('uses one notebook-scoped interface for configuration, ingestion, and management', async () => {
    const requests: Array<{ method: string; url: string; body: unknown }> = [];
    const fetch = vi.fn(async (request: Request) => {
      const text = await request.text();
      requests.push({
        method: request.method,
        url: request.url,
        body: text === '' ? undefined : JSON.parse(text),
      });

      if (request.method === 'GET' && request.url.endsWith('/notebook/sandbox-1')) {
        return Response.json({ data: {
          id: 'sandbox-1',
          runtimeUrl: 'https://runtime.example.test/actions?ticket=test-ticket',
          gitUrl: 'https://git.example.test/sandbox-1.git',
        } });
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
        url: 'https://api.phpsandbox.io/v1/notebook/sandbox-1/feedback/configuration',
        body: { widget: { targets: ['preview', 'publication'], types: ['bug', 'suggestion'] } },
      },
      {
        method: 'GET',
        url: 'https://api.phpsandbox.io/v1/notebook/sandbox-1/feedback/configuration',
        body: undefined,
      },
      {
        method: 'POST',
        url: 'https://api.phpsandbox.io/v1/notebook/sandbox-1/feedback',
        body: { type: 'bug', message: 'Save failed', author: { externalId: 'user-42' } },
      },
      {
        method: 'GET',
        url: 'https://api.phpsandbox.io/v1/notebook/sandbox-1/feedback?status=open&page=2',
        body: undefined,
      },
      {
        method: 'GET',
        url: 'https://api.phpsandbox.io/v1/notebook/sandbox-1/feedback/feedback-1',
        body: undefined,
      },
      {
        method: 'PATCH',
        url: 'https://api.phpsandbox.io/v1/notebook/sandbox-1/feedback/feedback-1',
        body: { status: 'resolved' },
      },
    ]);
  });
});
