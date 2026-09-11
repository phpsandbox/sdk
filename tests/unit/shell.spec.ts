import { describe, expect, it, vi } from 'vitest';
import Shell from '../../src/shell.js';

describe('Shell process handles', () => {
  it('splits stdout and stderr while preserving ordered output', async () => {
    let listener: ((event: { id: string; source: 'stdout' | 'stderr'; output: string }) => void) | null = null;
    const notebook = {
      listen: vi.fn((_event: string, handler: typeof listener) => {
        listener = handler;
        return { dispose: vi.fn() };
      }),
      invoke: vi.fn(async (action: string) => {
        if (action === 'shell.exec') {
          listener?.({ id: 'process-1', source: 'stdout', output: 'out' });
          listener?.({ id: 'process-1', source: 'stderr', output: 'err' });
          await new Promise((resolve) => setTimeout(resolve, 0));
          return { output: 'outerr', stdout: 'out', stderr: 'err', exitCode: 0 };
        }
        return true;
      }),
    };
    const process = new Shell(notebook as any).run('php artisan test', { id: 'process-1' });

    const output = [];
    for await (const chunk of process.output) {
      output.push([chunk.source, new TextDecoder().decode(chunk.data)]);
    }

    await expect(process.wait()).resolves.toMatchObject({ stdout: 'out', stderr: 'err', exitCode: 0 });
    expect(notebook.invoke).toHaveBeenCalledWith(
      'shell.exec',
      { command: 'php artisan test', opts: { id: 'process-1', tty: false } },
      { abortSignal: undefined }
    );
    expect(output).toEqual([['stdout', 'out'], ['stderr', 'err']]);
  });

  it('provides native stdin and kill operations', async () => {
    const invoke = vi.fn(async (action: string) => action === 'shell.exec'
      ? { output: '', stdout: '', stderr: '', exitCode: 0 }
      : true);
    const notebook = {
      listen: () => ({ dispose: () => {} }),
      invoke,
    };
    const process = new Shell(notebook as any).run(['cat'], { id: 'process-2' });

    const writer = process.stdin.getWriter();
    await writer.write(new TextEncoder().encode('hello'));
    await process.kill();

    expect(invoke).toHaveBeenCalledWith('shell.input', { id: 'process-2', input: 'hello' });
    expect(invoke).toHaveBeenCalledWith('shell.kill', { id: 'process-2' });
  });

  it('allows TTY execution to be explicitly enabled', async () => {
    const notebook = {
      listen: () => ({ dispose: () => {} }),
      invoke: vi.fn(async () => ({ output: '', stdout: '', stderr: '', exitCode: 0 })),
    };

    const process = new Shell(notebook as any).run('bash', { id: 'process-3', tty: true });
    await process.wait();

    expect(notebook.invoke).toHaveBeenCalledWith(
      'shell.exec',
      { command: 'bash', opts: { id: 'process-3', tty: true } },
      { abortSignal: undefined }
    );
  });

  it('returns non-zero exits as plain result data', async () => {
    const result = { output: 'failed', stdout: '', stderr: 'failed', exitCode: 1 };
    const notebook = {
      listen: () => ({ dispose: () => {} }),
      invoke: vi.fn(async () => result),
    };

    const completed = await new Shell(notebook as any).run('false').wait();

    expect(completed).toBe(result);
    expect(completed.exitCode).toBe(1);
  });
});
