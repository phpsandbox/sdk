import { afterEach, describe, expect, it, vi } from 'vitest';
import { decode, encode } from '@msgpack/msgpack';
import { WebSocketServer } from 'ws';
import type { AddressInfo } from 'node:net';
import EventManager from '../../src/events/index.js';
import { SendTimeoutError, TransportError } from '../../src/errors/index.js';
import { Transport } from '../../src/socket/index.js';

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const servers = new Set<WebSocketServer>();
const transports = new Set<Transport>();

function asBytes(data: unknown): Uint8Array {
  if (data instanceof Uint8Array) {
    return data;
  }

  if (data instanceof ArrayBuffer) {
    return new Uint8Array(data);
  }

  if (Array.isArray(data)) {
    return Buffer.concat(data);
  }

  return Buffer.from(data as Buffer);
}

function createServer(handler?: (message: any, socket: any) => void) {
  const server = new WebSocketServer({ port: 0 });
  servers.add(server);

  let connectionCount = 0;

  server.on('connection', (socket) => {
    connectionCount += 1;
    socket.on('message', (data) => {
      handler?.(decode(asBytes(data)), socket);
    });
  });

  const address = server.address() as AddressInfo;

  return {
    server,
    url: `ws://127.0.0.1:${address.port}`,
    get connectionCount() {
      return connectionCount;
    },
  };
}

function createTransport(url: string) {
  const transport = new Transport(url, EventManager.createInstance(), {
    pingInterval: 1000,
  });
  transports.add(transport);

  return transport;
}

afterEach(async () => {
  for (const transport of transports) {
    if (!transport.isClosed) {
      transport.close();
    }
  }
  transports.clear();

  await Promise.all(
    Array.from(servers).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.close(() => resolve());
        })
    )
  );
  servers.clear();
  vi.restoreAllMocks();
});

describe('Transport', () => {
  it('keeps request payloads and runtime errors out of debug logs', async () => {
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => undefined);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const server = createServer((message, socket) => {
      if (message.errorEvent) {
        socket.send(encode({
          event: message.errorEvent,
          data: { status: 403, code: 'PermissionDenied', message: 'private-runtime-error' },
        }));
      }
    });
    const transport = new Transport(server.url, EventManager.createInstance(), { debug: true });
    transports.add(transport);

    await expect(transport.call('auth.login', { runtimeTicket: 'private-ticket' })).rejects.toMatchObject({
      message: 'private-runtime-error',
    });
    expect(transport.send('terminal.write', { input: 'private-command' })).toBe(true);
    const logged = JSON.stringify([...debug.mock.calls, ...error.mock.calls]);
    expect(logged).toContain('auth.login');
    expect(logged).not.toContain('private-ticket');
    expect(logged).not.toContain('private-command');
    expect(logged).not.toContain('private-runtime-error');
  });

  it('redacts connection URL query parameters from debug logs', () => {
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => undefined);
    const transport = new Transport(
      'wss://okra.phpsandbox.io/n/notebook-1?ticket=signed-ticket',
      EventManager.createInstance(),
      {
        debug: true,
      }
    );
    transports.add(transport);

    const logged = JSON.stringify(debug.mock.calls);
    expect(logged).toContain('wss://okra.phpsandbox.io/n/notebook-1');
    expect(logged).not.toContain('signed-ticket');
    expect(logged).not.toContain('?ticket=');
  });

  it('resolves a fresh URL when reconnecting', async () => {
    const server = createServer();
    const urlProvider = vi.fn(async () => server.url);
    const transport = new Transport(urlProvider, EventManager.createInstance(), {
      pingInterval: 1000,
    });
    transports.add(transport);

    await transport.connect();
    for (const socket of server.server.clients) {
      socket.close();
    }

    await expect.poll(() => urlProvider.mock.calls.length, { timeout: 2000 }).toBeGreaterThan(1);
  });

  it('does not connect or send when a call is already aborted', async () => {
    const server = createServer();
    const transport = createTransport(server.url);
    const abort = new AbortController();
    abort.abort();

    await expect(transport.call('test.abort', {}, { abortSignal: abort.signal })).rejects.toMatchObject({
      name: 'AbortError',
    });

    await delay(20);

    expect(server.connectionCount).toBe(0);
  });

  it('honors retries=false', async () => {
    let messages = 0;
    const server = createServer(() => {
      messages += 1;
    });
    const transport = createTransport(server.url);

    await expect(transport.call('test.timeout', {}, { timeout: 20, retries: false })).rejects.toBeInstanceOf(
      SendTimeoutError
    );

    expect(messages).toBe(1);
  });

  it('rejects websocket send failures without waiting for request timeout', async () => {
    const server = createServer();
    const transport = createTransport(server.url);
    const expected = new Error('send failed');

    await transport.connect();

    (transport as any).rws.send = () => {
      throw expected;
    };

    await expect(transport.call('test.send-fails', {}, { timeout: 100 })).rejects.toMatchObject({
      code: 'ConnectionFailed',
      cause: expected,
    } satisfies Partial<TransportError>);
  });

  it('keeps multiple connect listeners registered', async () => {
    const server = createServer();
    const transport = createTransport(server.url);
    const calls: string[] = [];

    transport.onDidConnect(() => calls.push('first'));
    transport.onDidConnect(() => calls.push('second'));

    await transport.connect();

    expect(calls).toEqual(['first', 'second']);
  });

  it('resolves correlated responses', async () => {
    const server = createServer((message, socket) => {
      socket.send(
        Buffer.from(
          encode({
            event: 'response',
            data: {
              responseEvent: message.responseEvent,
              data: { ok: true },
            },
          })
        )
      );
    });
    const transport = createTransport(server.url);

    await expect(transport.call('test.response')).resolves.toEqual({ ok: true });
  });
});
