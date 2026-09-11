import { describe, expect, it, vi } from 'vitest';
import { Filesystem, type FileChange, type WatchOptions } from '../../src/filesystem.js';

class FakeNotebook {
  public readonly runtimeTransport = 'realtime';
  public readonly calls: Array<{ action: string; data: any }> = [];
  public readonly connectHandlers = new Set<() => void>();
  private readonly listeners = new Map<string, Set<(data: any) => void>>();
  private readonly followedFiles = new Map<string, () => void>();

  public async invoke(action: string, data: any = {}) {
    this.calls.push({ action, data });

    if (action === 'fs.find') {
      return [];
    }

    if (action === 'fs.download') {
      this.emit(`fs.download.${data.id}`, new Uint8Array([1, 2, 3]));
      return;
    }

    if (action === 'fs.readStream') {
      this.emit(`fs.read.${data.id}`, { id: data.id, data: new Uint8Array([1, 2]) });
      this.emit(`fs.read.${data.id}`, { id: data.id, data: new Uint8Array([3, 4]) });
      return true;
    }

    if (action === 'fs.follow') {
      return new Promise<boolean>((resolve) => {
        this.followedFiles.set(data.id, () => resolve(true));
      });
    }

    if (action === 'fs.cancelFollow') {
      this.followedFiles.get(data.id)?.();
      this.followedFiles.delete(data.id);
      return true;
    }

    if (action === 'fs.readFile') {
      if (data.lineRange) {
        return {
          lineStart: data.lineRange.lineStart,
          lineEnd: data.lineRange.lineEnd - 1,
          content: 'selected lines',
          error: 'Line range exceeds file length. Adjusted to available lines.',
        };
      }

      return new Uint8Array([1, 2, 3, 4]);
    }

    if (action === 'fs.tail') {
      return { content: 'last two lines' };
    }

    if (action === 'fs.writeChunk' || action === 'fs.endWrite' || action === 'fs.abortWrite') {
      return true;
    }

    if (action === 'fs.writeStream') {
      return true;
    }
  }

  public listen(event: string, handler: (data: any) => void) {
    const listeners = this.listeners.get(event) ?? new Set();
    listeners.add(handler);
    this.listeners.set(event, listeners);

    return {
      dispose: () => {
        listeners.delete(handler);
      },
    };
  }

  public onDidConnect(handler: () => void) {
    this.connectHandlers.add(handler);

    return {
      dispose: () => {
        this.connectHandlers.delete(handler);
      },
    };
  }

  public emit(event: string, data?: any) {
    for (const listener of this.listeners.get(event) ?? []) {
      listener(data);
    }
  }

  public connect() {
    for (const handler of this.connectHandlers) {
      handler();
    }
  }

  public listenerCount(event: string) {
    return this.listeners.get(event)?.size ?? 0;
  }
}

const createFilesystem = () => {
  const notebook = new FakeNotebook();
  const filesystem = new Filesystem(notebook as any);

  return { filesystem, notebook };
};

describe('Filesystem', () => {
  it('exposes one method per filesystem concept', () => {
    const methods = Object.getOwnPropertyNames(Filesystem.prototype);

    expect(methods).toEqual(expect.arrayContaining([
      'read', 'readText', 'readLines', 'readStream', 'follow', 'write', 'stat', 'list', 'createDirectory', 'move', 'copy', 'remove',
    ]));
    expect(methods).not.toEqual(expect.arrayContaining([
      'info', 'readFile', 'writeFile', 'mkdir', 'readDirectory', 'rename', 'delete',
    ]));
  });

  it('re-registers active watches through the injected reconnect capability', async () => {
    const { filesystem, notebook } = createFilesystem();
    const options: WatchOptions = { recursive: true, excludes: [] };

    await filesystem.watch('/app', options, vi.fn());
    notebook.connect();

    expect(notebook.calls.filter((call) => call.action === 'fs.watch')).toHaveLength(2);
  });

  it('preserves caller-provided find include and exclude globs', async () => {
    const { filesystem, notebook } = createFilesystem();

    await filesystem.find('*.php', {
      includes: ['app/**'],
      excludes: ['vendor/**'],
      maxResults: 20,
    });

    expect(notebook.calls[0]).toMatchObject({
      action: 'fs.find',
      data: {
        query: '*.php',
        options: {
          includes: ['app/**'],
          excludes: ['vendor/**'],
          maxResults: 20,
        },
      },
    });
  });

  it('removes disposed watches from reconnect tracking', async () => {
    const { filesystem, notebook } = createFilesystem();
    const options: WatchOptions = { recursive: true, excludes: [] };
    const onChange = vi.fn<(change: FileChange) => void>();

    const subscription = await filesystem.watch('/app', options, onChange);

    expect(notebook.calls.filter((call) => call.action === 'fs.watch')).toHaveLength(1);

    subscription.dispose();
    notebook.connect();

    expect(notebook.calls.filter((call) => call.action === 'fs.watch')).toHaveLength(1);
    expect(notebook.calls.filter((call) => call.action === 'fs.unwatch')).toHaveLength(1);
  });

  it('disposes download listeners after completion', async () => {
    const { filesystem, notebook } = createFilesystem();

    const blob = await filesystem.download();
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const downloadEvent = notebook.calls.find((call) => call.action === 'fs.download')?.data.id;

    expect(Array.from(bytes)).toEqual([1, 2, 3]);
    expect(notebook.listenerCount(`fs.download.${downloadEvent}`)).toBe(0);
  });

  it('streams reads as chunks without calling the buffered read action', async () => {
    const { filesystem, notebook } = createFilesystem();
    const chunks: number[][] = [];

    for await (const chunk of filesystem.readStream('large.zip')) {
      chunks.push(Array.from(chunk));
    }

    expect(chunks).toEqual([[1, 2], [3, 4]]);
    expect(notebook.calls.some((call) => call.action === 'fs.readFile')).toBe(false);
  });

  it('follows appended file bytes until the stream is cancelled', async () => {
    const { filesystem, notebook } = createFilesystem();
    const stream = filesystem.follow('storage/logs/app.log', { lines: 25 });
    const reader = stream.getReader();
    const follow = notebook.calls.find((call) => call.action === 'fs.follow');

    expect(follow).toMatchObject({
      data: { path: 'storage/logs/app.log', lines: 25 },
    });

    notebook.emit(`fs.follow.${follow?.data.id}`, {
      id: follow?.data.id,
      data: new Uint8Array([1, 2, 3]),
    });
    await expect(reader.read()).resolves.toEqual({ done: false, value: new Uint8Array([1, 2, 3]) });

    await reader.cancel();

    expect(notebook.calls.at(-1)).toEqual({
      action: 'fs.cancelFollow',
      data: { id: follow?.data.id },
    });
    expect(notebook.listenerCount(`fs.follow.${follow?.data.id}`)).toBe(0);
  });

  it('cancels a followed file when its abort signal fires', async () => {
    const { filesystem, notebook } = createFilesystem();
    const controller = new AbortController();
    const reader = filesystem.follow('storage/logs/app.log', { signal: controller.signal }).getReader();
    const follow = notebook.calls.find((call) => call.action === 'fs.follow');

    controller.abort(new Error('Stopped'));

    await expect(reader.read()).rejects.toThrow('Stopped');
    expect(notebook.calls.at(-1)).toEqual({
      action: 'fs.cancelFollow',
      data: { id: follow?.data.id },
    });
    expect(notebook.listenerCount(`fs.follow.${follow?.data.id}`)).toBe(0);
  });

  it('writes each incoming chunk without collecting the stream first', async () => {
    const { filesystem, notebook } = createFilesystem();
    const contents = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2]));
        controller.enqueue(new Uint8Array([3, 4]));
        controller.close();
      },
    });

    await expect(filesystem.write('large.zip', contents)).resolves.toBeUndefined();

    const actions = notebook.calls.map((call) => call.action);
    expect(actions).toEqual(['fs.writeStream', 'fs.writeChunk', 'fs.writeChunk', 'fs.endWrite']);
    expect(notebook.calls.filter((call) => call.action === 'fs.writeChunk').map((call) => Array.from(call.data.contents)))
      .toEqual([[1, 2], [3, 4]]);
  });

  it('provides explicit eager byte and text reads', async () => {
    const { filesystem } = createFilesystem();

    await expect(filesystem.read('data.bin')).resolves.toEqual(new Uint8Array([1, 2, 3, 4]));
    await expect(filesystem.readText('data.bin')).resolves.toBe('\u0001\u0002\u0003\u0004');
  });

  it('reads a server-side line range without buffering the entire file', async () => {
    const { filesystem, notebook } = createFilesystem();

    await expect(filesystem.readLines('large.log', { start: 10, end: 20 })).resolves.toEqual({
      start: 10,
      end: 19,
      content: 'selected lines',
      warning: 'Line range exceeds file length. Adjusted to available lines.',
    });
    expect(notebook.calls.at(-1)).toEqual({
      action: 'fs.readFile',
      data: {
        path: 'large.log',
        lineRange: { lineStart: 10, lineEnd: 20 },
      },
    });
  });

  it('returns the content from the runtime tail response', async () => {
    const { filesystem, notebook } = createFilesystem();

    await expect(filesystem.tail('storage/logs/app.log', { lines: 2 })).resolves.toBe('last two lines');
    expect(notebook.calls.at(-1)).toEqual({
      action: 'fs.tail',
      data: { path: 'storage/logs/app.log', lines: 2 },
    });
  });

  it('writes async iterables incrementally', async () => {
    const { filesystem, notebook } = createFilesystem();
    async function* contents() {
      yield new Uint8Array([1]);
      yield new Uint8Array([2]);
    }

    await filesystem.write('iterable.bin', contents());

    expect(notebook.calls.filter((call) => call.action === 'fs.writeChunk').map((call) => Array.from(call.data.contents)))
      .toEqual([[1], [2]]);
  });
});
