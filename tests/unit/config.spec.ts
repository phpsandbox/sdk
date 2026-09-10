import { describe, expect, it, vi } from 'vitest';
import Config, { type ProjectConfig } from '../../src/config.js';
import type { NotebookInstance } from '../../src/index.js';

describe('Notebook configuration', () => {
  it('reads and updates configuration through explicit actions', async () => {
    const current: ProjectConfig = { ports: [{ localPort: 8000, primary: true }] };
    const invoke = vi.fn(async () => current);
    const config = new Config({ invoke } as unknown as NotebookInstance);

    await expect(config.get()).resolves.toBe(current);
    await expect(config.update(current)).resolves.toBe(current);
    await expect(config.setPorts(current.ports!)).resolves.toBe(current);

    expect(invoke.mock.calls).toEqual([
      ['config.get'],
      ['config.update', { config: current }],
      ['config.set-ports', { ports: current.ports }],
    ]);
  });
});
