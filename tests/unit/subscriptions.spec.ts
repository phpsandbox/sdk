import { describe, expect, it } from 'vitest';
import Lsp from '../../src/lsp.js';
import Repl from '../../src/repl.js';

class FakeNotebook {
  public readonly data = { id: 'fake-notebook-id' };
  private readonly listeners = new Map<string, Set<(data: any) => void>>();

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

  public onDidDisconnect(handler: () => void) {
    return this.listen('okra.disconnected', handler);
  }

  public listenerCount(event: string): number {
    return this.listeners.get(event)?.size ?? 0;
  }
}

describe('subscription helpers', () => {
  it('returns disposables from service listener helpers', () => {
    const notebook = new FakeNotebook();
    const repl = new Repl(notebook as any);
    const lsp = new Lsp(notebook as any);

    const disposables = [
      repl.listen('repl.output', () => {}),
      repl.onOutput(() => {}),
      lsp.listen('lsp-1', 'lsp.response', () => {}),
      lsp.onClose('lsp-1', () => {}),
      lsp.onError('lsp-1', () => {}),
      lsp.onResponse('lsp-1', () => {}),
      lsp.onClientDisconnect(() => {}),
      lsp.connection('lsp-2').onMessage(() => {}),
      lsp.connection('lsp-2').onError(() => {}),
      lsp.connection('lsp-2').onClose(() => {}),
      lsp.connection('lsp-2').onClientDisconnect(() => {}),
    ];

    for (const disposable of disposables) {
      expect(disposable).toEqual({ dispose: expect.any(Function) });
    }

    expect({
      replOutput: notebook.listenerCount('repl.output'),
      lsp1Response: notebook.listenerCount('lsp.response.lsp-1'),
      lsp1Closed: notebook.listenerCount('lsp.closed.lsp-1'),
      lsp1Error: notebook.listenerCount('lsp.error.lsp-1'),
      lsp2Response: notebook.listenerCount('lsp.response.lsp-2'),
      lsp2Closed: notebook.listenerCount('lsp.closed.lsp-2'),
      lsp2Error: notebook.listenerCount('lsp.error.lsp-2'),
      disconnected: notebook.listenerCount('okra.disconnected'),
    }).toEqual({
      replOutput: 2,
      lsp1Response: 2,
      lsp1Closed: 1,
      lsp1Error: 1,
      lsp2Response: 1,
      lsp2Closed: 1,
      lsp2Error: 1,
      disconnected: 2,
    });

    for (const disposable of disposables) {
      disposable.dispose();
    }

    expect([
      'repl.output',
      'lsp.response.lsp-1',
      'lsp.closed.lsp-1',
      'lsp.error.lsp-1',
      'lsp.response.lsp-2',
      'lsp.closed.lsp-2',
      'lsp.error.lsp-2',
      'okra.disconnected',
    ].every((event) => notebook.listenerCount(event) === 0)).toBe(true);
  });
});
