import { describe, expect, it, vi } from 'vitest';
import { PHPSandbox } from '../../src/index.js';

describe('publication domains', () => {
  it('lists, creates, refreshes and deletes domains using encoded resource IDs', async () => {
    const requests: Array<{ method: string; url: string; body: string }> = [];
    const domain = { id: 'domain/id', hostname: 'app.example.com', status: 'pending' };
    const fetch = vi.fn(async (request: Request) => {
      requests.push({ method: request.method, url: request.url, body: await request.text() });
      if (request.url.endsWith('/publications/pub')) return Response.json({ data: { id: 'publication/id' } });
      if (request.method === 'DELETE') return Response.json({ data: { deleted: true } });
      if (request.method === 'GET') return Response.json({ data: [domain] });
      return Response.json({ data: domain });
    });
    const client = PHPSandbox.rest('token', 'https://api.phpsandbox.io/v1', { fetch: fetch as unknown as typeof globalThis.fetch });
    const publication = await client.publications.get('pub');
    await expect(publication.domains.list()).resolves.toEqual([domain]);
    await expect(publication.domains.create('app.example.com')).resolves.toEqual(domain);
    await expect(publication.domains.refresh('domain/id')).resolves.toEqual(domain);
    await publication.domains.delete('domain/id');
    expect(requests.slice(1)).toEqual([
      { method: 'GET', url: 'https://api.phpsandbox.io/v1/publications/publication%2Fid/domains', body: '' },
      { method: 'POST', url: 'https://api.phpsandbox.io/v1/publications/publication%2Fid/domains', body: '{"hostname":"app.example.com"}' },
      { method: 'POST', url: 'https://api.phpsandbox.io/v1/publications/publication%2Fid/domains/domain%2Fid/refresh', body: '' },
      { method: 'DELETE', url: 'https://api.phpsandbox.io/v1/publications/publication%2Fid/domains/domain%2Fid', body: '' },
    ]);
  });
  it('propagates domain validation and authorization errors', async () => {
    const fetch = vi.fn(async (request: Request) => request.url.endsWith('/publications/pub')
      ? Response.json({ data: { id: 'pub' } })
      : Response.json({ error: { message: 'Domain unavailable', code: 'UnprocessableEntity', status: 422 } }, { status: 422 }));
    const client = PHPSandbox.rest('token', 'https://api.phpsandbox.io/v1', { fetch: fetch as unknown as typeof globalThis.fetch });
    const publication = await client.publications.get('pub');
    await expect(publication.domains.create('taken.example.com')).rejects.toThrow('Domain unavailable');
  });
});
