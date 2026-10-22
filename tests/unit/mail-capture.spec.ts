import { afterEach, expect, it, vi } from 'vitest';
import { PHPSandbox } from '../../src/index.js';

afterEach(() => vi.unstubAllGlobals());

it('captures a development email over the notebook mail API without runtime dispatch', async () => {
  const input = {
    requestId: '9cab94a8-acb1-4101-b537-35c75caa3319',
    from: 'hello@example.com',
    fromName: 'Example',
    to: 'alex@example.com',
    subject: 'Welcome',
    text: 'Hello Alex',
  };
  const fetch = vi.fn(async (request: Request) => {
    if (request.url === 'https://api.example.test/v1/notebook/example') {
      return Response.json({
        data: { id: 'example', runtimeUrl: 'wss://runtime.example.test/connection?ticket=runtime-ticket' },
      });
    }
    expect(request.url).toBe('https://api.example.test/v1/notebook/example/mails');
    expect(request.method).toBe('POST');
    expect(request.headers.get('authorization')).toBe('Bearer token');
    expect(await request.json()).toEqual(input);
    return Response.json({ data: { hash: 'captured-email', subject: 'Welcome' } });
  });
  vi.stubGlobal('fetch', fetch);
  const notebook = await PHPSandbox.rest('token', 'https://api.example.test/v1').notebook.get('example');

  await expect(notebook.mail.capture(input)).resolves.toMatchObject({ hash: 'captured-email', subject: 'Welcome' });
  expect(fetch).toHaveBeenCalledTimes(2);
});
