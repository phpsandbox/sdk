import { describe, expect, it, vi } from 'vitest';
import { NotebookInstance, PHPSandbox, PHPSandboxError, type NotebookData } from '../../src/index.js';

const notebookData: NotebookData = {
  id: 'notebook-1',
  gitUrl: 'https://git.phpsandbox.io/notebook-1.git',
  runtimeUrl: 'wss://okra.phpsandbox.io/n/notebook-1?ticket=signed-ticket',
};

const initialized = {
  type: 'success' as const,
  message: '',
  data: {
    env: [],
    previewUrl: 'https://notebook-1.ciroue.com',
    ports: [],
    provisioned: false,
    provisioningAction: null,
  },
};

function openRestNotebook(
  data: NotebookData = notebookData,
  options: Parameters<typeof PHPSandbox.rest>[2] = {}
): NotebookInstance {
  return PHPSandbox.rest('core-token', undefined, options).notebook.open(data);
}

describe('explicit runtime transports', () => {
  it.each(['create', 'fork'] as const)('returns from %s without a separate readiness request', async (operation) => {
    const requests: Request[] = [];
    const fetch = vi.fn(async (request: Request) => {
      requests.push(request);
      return Response.json({ data: notebookData });
    }) as unknown as typeof globalThis.fetch;
    const client = PHPSandbox.rest('core-token', undefined, { fetch });

    if (operation === 'create') {
      await client.notebook.create('standard');
    } else {
      await client.notebook.open({ ...notebookData, id: 'standard' }).fork();
    }

    expect(requests).toHaveLength(1);
    expect(new URL(requests[0].url).pathname).toBe(
      operation === 'create' ? '/v1/notebook' : '/v1/notebook/standard/fork'
    );
  });

  it.each([
    ['wss:', 'https:'],
    ['https:', 'https:'],
    ['ws:', 'http:'],
    ['http:', 'http:'],
  ])('preserves transport security for %s runtime URLs', async (inputProtocol, expectedProtocol) => {
    const requests: Request[] = [];
    const fetch = vi.fn(async (request: Request) => {
      requests.push(request);
      return Response.json({ data: initialized });
    }) as unknown as typeof globalThis.fetch;
    const notebook = openRestNotebook({
      ...notebookData,
      runtimeUrl: notebookData.runtimeUrl.replace('wss:', inputProtocol),
    }, { fetch });

    await notebook.ready();
    expect(new URL(requests[0].url).protocol).toBe(expectedProtocol);
    expect(requests[0].redirect).toBe('manual');
  });

  it('selects only the requested transport', () => {
    expect(PHPSandbox.realtime('token').runtimeTransport).toBe('realtime');
    expect(PHPSandbox.rest('token').runtimeTransport).toBe('rest');
  });

  it('keeps REST initialization lazy until runtime work begins', async () => {
    const fetch = vi.fn(async () => Response.json({ data: initialized })) as unknown as typeof globalThis.fetch;
    const notebook = openRestNotebook(notebookData, { fetch });

    await Promise.resolve();

    expect(fetch).not.toHaveBeenCalled();

    await expect(notebook.ready()).resolves.toEqual(initialized);
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('starts lazy REST initialization with the first supported action', async () => {
    const fetch = vi.fn(async (request: Request) => {
      const path = new URL(request.url).pathname;

      return Response.json({ data: path.endsWith('/runtime') ? initialized : [] });
    }) as unknown as typeof globalThis.fetch;
    const notebook = openRestNotebook(notebookData, { fetch });

    await expect(notebook.runtime.ports.list()).resolves.toEqual([]);
    await expect(notebook.ready()).resolves.toEqual(initialized);

    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('resolves unopened port URLs over REST', async () => {
    const requests: Request[] = [];
    const resolvedPort = {
      port: 4848,
      localPort: 4848,
      externalPort: 4848,
      subdomain: 'notebook-1-4848',
      url: 'https://notebook-1-4848.ciroue.com',
      default: false,
    };
    const fetch = vi.fn(async (request: Request) => {
      requests.push(request);
      return Response.json({ data: request.url.endsWith('/runtime') ? initialized : resolvedPort });
    }) as unknown as typeof globalThis.fetch;
    const notebook = openRestNotebook(notebookData, { fetch });

    await expect(notebook.runtime.ports.resolve(4848)).resolves.toEqual(resolvedPort);

    const resolveRequest = requests.find((request) => request.url.endsWith('/runtime/container/ports/resolve'))!;
    expect(resolveRequest.method).toBe('POST');
    expect(new URL(resolveRequest.url).pathname).toBe('/api/v1/notebooks/notebook-1/runtime/container/ports/resolve');
    await expect(resolveRequest.json()).resolves.toEqual({ port: 4848 });
  });

  it('invokes REST actions with the runtime ticket as bearer auth', async () => {
    const requests: Request[] = [];
    const fetch = vi.fn(async (request: Request) => {
      requests.push(request);
      const path = new URL(request.url).pathname;

      return Response.json({
        data: path.endsWith('/runtime') ? initialized : { memory: 128 },
      });
    }) as unknown as typeof globalThis.fetch;
    const client = PHPSandbox.rest('core-token', undefined, { fetch });
    const notebook = client.notebook.open(notebookData);

    await expect(notebook.ready()).resolves.toEqual(initialized);
    await expect(notebook.invoke('container.stats')).resolves.toEqual({
      memory: 128,
    });

    expect(requests).toHaveLength(2);
    expect(requests[1].url).toBe('https://okra.phpsandbox.io/api/v1/notebooks/notebook-1/runtime/container/stats');
    expect(requests[1].method).toBe('GET');
    expect(requests[1].headers.get('authorization')).toBe('Bearer signed-ticket');
    expect(requests[1].headers.get('x-okra-connection-data')).toBeNull();
    expect(new URL(requests[1].url).searchParams.has('ticket')).toBe(false);
  });

  it('refreshes an expired REST ticket once and retries explicitly over REST', async () => {
    const requests: Request[] = [];
    const refreshedRuntimeUrl = notebookData.runtimeUrl!.replace('signed-ticket', 'refreshed-ticket');
    const runtimeUrlProvider = vi.fn(async () => refreshedRuntimeUrl);
    const fetch = vi.fn(async (request: Request) => {
      requests.push(request);
      if (request.headers.get('authorization') === 'Bearer signed-ticket') {
        return Response.json({ error: { status: 401, code: 'AuthenticationRequired', message: 'Authentication required' } }, { status: 401 });
      }

      return Response.json({ data: initialized });
    }) as unknown as typeof globalThis.fetch;
    const notebook = openRestNotebook(notebookData, { fetch, runtimeUrlProvider });

    await expect(notebook.ready()).resolves.toEqual(initialized);

    expect(requests).toHaveLength(2);
    expect(requests[0].headers.get('authorization')).toBe('Bearer signed-ticket');
    expect(requests[1].headers.get('authorization')).toBe('Bearer refreshed-ticket');
    expect(runtimeUrlProvider).toHaveBeenCalledOnce();
    expect(runtimeUrlProvider).toHaveBeenCalledWith('notebook-1');
  });

  it('rejects legacy connection URLs without a ticket', () => {
    const legacyData = {
      ...notebookData,
      runtimeUrl: 'wss://okra.phpsandbox.io/n/notebook-1?auth=legacy',
    };

    expect(() => openRestNotebook(legacyData)).toThrow(
      'The notebook connection does not contain a runtime ticket.'
    );
  });

  it('does not make an implicit Core request when no runtime URL provider is supplied', async () => {
    const fetch = vi.fn(async () =>
      Response.json({ error: { status: 401, code: 'AuthenticationRequired', message: 'Authentication required' } }, { status: 401 })
    ) as unknown as typeof globalThis.fetch;
    const notebook = openRestNotebook(notebookData, { fetch });

    await expect(notebook.ready()).rejects.toMatchObject({
      source: 'runtime',
      status: 401,
      code: 'AuthenticationRequired',
    });
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('rejects top-level runtime authorization errors returned by the edge', async () => {
    const fetch = vi.fn(async () =>
      Response.json({ message: 'Runtime capability expired' }, { status: 401 })
    ) as unknown as typeof globalThis.fetch;
    const notebook = openRestNotebook(notebookData, { fetch });

    await expect(notebook.ready()).rejects.toMatchObject({
      code: 'InvalidResponse',
    });
  });

  it('rejects realtime-only actions locally without falling back', async () => {
    const fetch = vi.fn(async (request: Request) => {
      return Response.json({ data: initialized });
    }) as unknown as typeof globalThis.fetch;
    const notebook = openRestNotebook(notebookData, { fetch });
    await notebook.ready();

    await expect(
      notebook.invoke('terminal.create', {
        id: 'terminal-1',
        kind: 'shell',
        size: [80, 24],
      })
    ).rejects.toThrow(PHPSandboxError);
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('writes binary file content directly without changing any byte values', async () => {
    const requests: Request[] = [];
    const fetch = vi.fn(async (request: Request) => {
      requests.push(request);
      return Response.json({ data: initialized });
    }) as unknown as typeof globalThis.fetch;
    const notebook = openRestNotebook(notebookData, { fetch });
    const bytes = new Uint8Array([0, 1, 127, 128, 254, 255]);

    await notebook.invoke('fs.writeFile', {
      path: '/image.png',
      contents: bytes,
      options: {},
    });

    const writeRequest = requests.at(-1)!;
    expect(writeRequest.method).toBe('PUT');
    const writeUrl = new URL(writeRequest.url);
    expect(writeUrl.pathname).toBe('/api/v1/notebooks/notebook-1/runtime/files/content');
    expect(writeUrl.searchParams.get('path')).toBe('/image.png');
    expect(writeRequest.headers.get('content-type')).toBe('application/octet-stream');
    expect(new Uint8Array(await writeRequest.arrayBuffer())).toEqual(bytes);
  });

  it('reads binary file content directly without changing any byte values', async () => {
    const requests: Request[] = [];
    const bytes = new Uint8Array([0, 1, 127, 128, 254, 255]);
    const fetch = vi.fn(async (request: Request) => {
      requests.push(request);
      return new Response(bytes, {
        headers: { 'Content-Type': 'application/octet-stream' },
      });
    }) as unknown as typeof globalThis.fetch;
    const notebook = openRestNotebook(notebookData, { fetch });

    await expect(notebook.invoke('fs.readFile', { path: '/image.png' })).resolves.toEqual(bytes);

    const readRequest = requests.at(-1)!;
    expect(readRequest.method).toBe('GET');
    expect(new URL(readRequest.url).pathname).toBe('/api/v1/notebooks/notebook-1/runtime/files/content');
    expect(new URL(readRequest.url).searchParams.get('path')).toBe('/image.png');
  });

  it('fails connection-only operations clearly for REST clients', () => {
    const fetch = vi.fn(async () => Response.json({ data: initialized })) as unknown as typeof globalThis.fetch;
    const notebook = openRestNotebook(notebookData, { fetch });

    expect(() => notebook.connected()).toThrow(PHPSandboxError);
    expect(() => notebook.send('ping')).toThrow(PHPSandboxError);
    expect(fetch).not.toHaveBeenCalled();
  });
});
