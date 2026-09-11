import { describe, expect, it, vi } from 'vitest';
import Composer from '../../src/composer.js';

describe('Composer process handles', () => {
  it('streams stdout and stderr and returns the process result', async () => {
    let listener: ((event: { id: string; source: 'stdout' | 'stderr'; output: string }) => void) | null = null;
    const notebook = {
      data: { id: 'notebook-1' },
      listen: vi.fn((_event: string, handler: typeof listener) => {
        listener = handler;
        return { dispose: vi.fn() };
      }),
      invoke: vi.fn(async (action: string) => {
        if (action === 'composer.invoke') {
          listener?.({ id: 'composer-1', source: 'stdout', output: 'Installing' });
          listener?.({ id: 'composer-1', source: 'stderr', output: 'Warning' });
          await new Promise((resolve) => setTimeout(resolve, 0));
          return {
            output: 'InstallingWarning',
            stdout: 'Installing',
            stderr: 'Warning',
            exitCode: 0,
          };
        }
        return true;
      }),
    };
    const composer = new Composer(notebook as any, {} as any);
    const process = composer.run('install');

    const output = [];
    for await (const chunk of process.output) {
      output.push([chunk.source, new TextDecoder().decode(chunk.data)]);
    }

    await expect(process.wait()).resolves.toMatchObject({ stdout: 'Installing', stderr: 'Warning', exitCode: 0 });
    expect(output).toEqual([['stdout', 'Installing'], ['stderr', 'Warning']]);
  });

  it('can stop a running Composer command', async () => {
    const notebook = {
      data: { id: 'notebook-1' },
      listen: () => ({ dispose: () => {} }),
      invoke: vi.fn(async (action: string) => action === 'composer.invoke'
        ? { output: '', stdout: '', stderr: '', exitCode: 0 }
        : true),
    };
    const process = new Composer(notebook as any, {} as any).run('install');

    await process.kill();

    expect(notebook.invoke).toHaveBeenCalledWith('composer.kill', { id: process.id });
  });
});
