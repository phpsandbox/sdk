import { afterEach, describe, expect, it, vi } from 'vitest';
import { NotebookInstance, type NotebookInitSuccessResult } from '../../src/index.js';
import { Beacon, connectBeacon } from '../../src/beacon/index.js';
import { RemoteError } from '../../src/errors/index.js';

class FakeSocket {
  public isConnected = false;
  public readonly connectListeners = new Set<() => void>();
  public readonly closeListeners = new Set<() => void>();
  public readonly bootErrorListeners = new Set<(error: RemoteError<'NotebookUnavailable'>) => void>();

  public getTerminalError(): Error | null {
    return null;
  }

  public onDidConnect(listener: () => void) {
    this.connectListeners.add(listener);

    return {
      dispose: () => {
        this.connectListeners.delete(listener);
      },
    };
  }

  public onDidClose(listener: () => void) {
    this.closeListeners.add(listener);

    return {
      dispose: () => {
        this.closeListeners.delete(listener);
      },
    };
  }

  public onDidBootError(listener: (error: RemoteError<'NotebookUnavailable'>) => void) {
    this.bootErrorListeners.add(listener);

    return {
      dispose: () => {
        this.bootErrorListeners.delete(listener);
      },
    };
  }

  public emitConnect(): void {
    this.isConnected = true;
    for (const listener of [...this.connectListeners]) {
      listener();
    }
  }

  public emitClose(): void {
    for (const listener of [...this.closeListeners]) {
      listener();
    }
  }

  public emitBootError(error: RemoteError<'NotebookUnavailable'>): void {
    for (const listener of [...this.bootErrorListeners]) {
      listener(error);
    }
  }
}

function createNotebook(socket: FakeSocket): NotebookInstance {
  const notebook = Object.create(NotebookInstance.prototype) as NotebookInstance;
  (notebook as any).socket = socket;

  return notebook;
}

function createReadyNotebook(previewUrl: string): NotebookInstance {
  const notebook = Object.create(NotebookInstance.prototype) as NotebookInstance & {
    ready: () => Promise<NotebookInitSuccessResult>;
  };

  notebook.ready = async () => ({
    type: 'success',
    message: 'Ready',
    data: {
      env: [],
      previewUrl,
      ports: [],
      provisioned: false,
      provisioningAction: null,
    },
  });

  return notebook;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('NotebookInstance connection waits', () => {
  it('provides exec as the concise one-shot command API', async () => {
    const notebook = Object.create(NotebookInstance.prototype) as NotebookInstance;
    const result = { output: 'done', stdout: 'done', stderr: '', exitCode: 0 };
    const wait = vi.fn(async () => result);
    const run = vi.fn(() => ({ wait }));
    (notebook as any).shell = { run };

    await expect(notebook.exec('php', ['-v'])).resolves.toBe(result);
    expect(run).toHaveBeenCalledWith('php', ['-v'], undefined);
    expect(wait).toHaveBeenCalledOnce();
  });

  it('disposes temporary connected() listeners after connection', async () => {
    const socket = new FakeSocket();
    const notebook = createNotebook(socket);
    const promise = notebook.connected();

    expect(socket.connectListeners.size).toBe(1);
    expect(socket.closeListeners.size).toBe(1);
    expect(socket.bootErrorListeners.size).toBe(1);

    socket.emitConnect();

    await expect(promise).resolves.toBe(notebook);
    expect(socket.connectListeners.size).toBe(0);
    expect(socket.closeListeners.size).toBe(0);
    expect(socket.bootErrorListeners.size).toBe(0);
  });

  it('disposes temporary connected() listeners after close rejection', async () => {
    const socket = new FakeSocket();
    const notebook = createNotebook(socket);
    const promise = notebook.connected();

    socket.emitClose();

    await expect(promise).rejects.toThrow('Connection closed');
    expect(socket.connectListeners.size).toBe(0);
    expect(socket.closeListeners.size).toBe(0);
    expect(socket.bootErrorListeners.size).toBe(0);
  });

  it('connects a beacon and waits for the iframe handshake', async () => {
    const addEventListener = vi.fn();
    const removeEventListener = vi.fn();

    vi.stubGlobal('window', {
      addEventListener,
      removeEventListener,
      location: {
        href: 'https://app.example.test/workspace',
        origin: 'https://app.example.test',
      },
    });

    const iframe = {
      src: '',
      contentWindow: {},
    } as HTMLIFrameElement;
    const connection = connectBeacon(iframe, { timeout: 100 });
    const messageHandler = addEventListener.mock.calls.find(([event]) => event === 'message')?.[1];
    messageHandler({
      source: iframe.contentWindow,
      origin: 'https://app.example.test',
      data: { type: 'beacon:channel-established' },
    });
    const beacon = await connection;

    expect(beacon).toBeInstanceOf(Beacon);
    expect(beacon.isReady).toBe(true);
    expect(addEventListener).toHaveBeenCalledWith('message', expect.any(Function));
  });
});
