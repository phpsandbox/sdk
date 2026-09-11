import { describe, expect, it, vi } from 'vitest';
import { NotebookInstance } from '../../src/index.js';
import Runtime from '../../src/runtime.js';

describe('notebook runtime facade', () => {
  it('keeps notebook lifecycle actions on the notebook', async () => {
    const notebook = Object.create(NotebookInstance.prototype) as NotebookInstance;
    const invoke = vi.fn(async () => undefined);
    Object.defineProperty(notebook, 'invoke', { value: invoke });

    await notebook.stop();
    await notebook.restart();

    expect(invoke.mock.calls.map(([action]) => action)).toEqual([
      'container.stop',
      'container.restart',
    ]);
  });

  it('keeps PHP configuration under runtime', async () => {
    const invoke = vi.fn(async () => ({ version: '8.4' }));
    const notebook = {
      invoke,
      runtimeTransport: 'rest',
    } as unknown as NotebookInstance;
    const runtime = new Runtime(notebook);

    await expect(runtime.setPhpVersion('8.4')).resolves.toEqual({ version: '8.4' });
    expect(invoke).toHaveBeenCalledWith('container.set-php', { version: '8.4' });
  });
});
