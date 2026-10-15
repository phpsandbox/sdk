import { describe, expect, it, vi } from 'vitest';
import { type NotebookInstance } from '../../src/index.js';
import Lsp from '../../src/lsp.js';

describe('LSP connection action ownership', () => {
  it.each([
    ['start', 'lsp.start'],
    ['dispose', 'lsp.close'],
  ] as const)('returns the %s action promise so callers can handle remote failures', async (method, action) => {
    const failure = new Error('LSP is unavailable');
    const invoke = vi.fn().mockRejectedValue(failure);
    const lsp = new Lsp({ invoke } as unknown as NotebookInstance);
    const connection = lsp.connection('language-server');

    await expect(connection[method]()).rejects.toBe(failure);
    expect(invoke).toHaveBeenCalledWith(action, { id: 'language-server' });
  });
});
