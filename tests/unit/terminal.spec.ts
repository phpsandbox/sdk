import { describe, expect, it, vi } from 'vitest';
import Terminal from '../../src/terminal.js';

class FakeNotebook {
  public readonly calls: Array<{ action: string; data: any }> = [];
  private readonly listeners = new Map<string, Set<(data: any) => void>>();
  public createError: Error | null = null;

  public async invoke(action: string, data: any = {}) {
    this.calls.push({ action, data });

    if (action === 'terminal.create') {
      if (this.createError) {
        throw this.createError;
      }

      return {
        id: data.id,
        command: data.command,
        kind: 'process',
        created: true,
      };
    }

    if (action === 'terminal.close') {
      return true;
    }

    if (action === 'terminal.input') {
      return true;
    }

    throw new Error(`Unexpected action: ${action}`);
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

  public send(action: string, data: any = {}) {
    this.calls.push({ action, data });
    return true;
  }

  public emit(event: string, data?: any) {
    for (const listener of this.listeners.get(event) ?? []) {
      listener(data);
    }
  }
}

describe('Terminal', () => {
  it('keeps terminal control on returned handles', () => {
    const methods = Object.getOwnPropertyNames(Terminal.prototype);

    expect(methods).toEqual(expect.arrayContaining(['list', 'create', 'attach']));
    expect(methods).not.toEqual(expect.arrayContaining(['spawn', 'input', 'resize', 'onOutput', 'listen']));
  });

  it('removes abort listeners when a process exits', async () => {
    const notebook = new FakeNotebook();
    const terminal = new Terminal(notebook as any);
    const abort = new AbortController();
    const addSpy = vi.spyOn(abort.signal, 'addEventListener');
    const removeSpy = vi.spyOn(abort.signal, 'removeEventListener');

    const process = await terminal.create({
      command: 'php',
      id: 'term-1',
      abortSignal: abort.signal,
    });

    expect(addSpy).toHaveBeenCalledWith('abort', expect.any(Function), { once: true });

    notebook.emit('terminal.close.term-1', {
      id: 'term-1',
      command: 'php',
      kind: 'process',
      created: true,
      exitCode: 0,
    });

    await expect(process.wait()).resolves.toBe(0);
    expect(removeSpy).toHaveBeenCalledWith('abort', expect.any(Function));
  });

  it('removes abort listeners when creation fails', async () => {
    const notebook = new FakeNotebook();
    const terminal = new Terminal(notebook as any);
    const abort = new AbortController();
    const removeSpy = vi.spyOn(abort.signal, 'removeEventListener');
    const expected = new Error('creation failed');
    notebook.createError = expected;

    await expect(
      terminal.create({
        command: 'php',
        id: 'term-2',
        abortSignal: abort.signal,
      })
    ).rejects.toBe(expected);

    expect(removeSpy).toHaveBeenCalledWith('abort', expect.any(Function));
  });
});
