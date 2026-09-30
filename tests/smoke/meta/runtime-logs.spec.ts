import type { NotebookInstance, RuntimeLogEntry } from '@phpsandbox/sdk';
import { describe, expect, test, vi } from 'vitest';
import { emitRuntimeLogMarker } from '../support/runtime-logs.js';

describe('runtime log smoke stimulus', () => {
  test('retries emission until the subscription delivers the exact marker and cancels the stream', async () => {
    let controller!: ReadableStreamDefaultController<RuntimeLogEntry>;
    const cancel = vi.fn();
    const follow = vi.fn(() => new ReadableStream<RuntimeLogEntry>({
      start(streamController) { controller = streamController; },
      cancel,
    }));
    const marker = 'sdk-smoke-log-test';
    const exec = vi.fn(async () => {
      if (exec.mock.calls.length === 2) {
        for (const message of ['', 'unrelated runtime activity', marker]) {
          controller.enqueue({ timestamp: '', source: 'runtime', message });
        }
      }
      return { exitCode: 0, stdout: '', stderr: '' };
    });
    const sandbox = { runtime: { logs: { follow } }, exec } as unknown as NotebookInstance;

    await expect(emitRuntimeLogMarker(sandbox, marker)).resolves.toMatchObject({ message: marker });
    expect(exec).toHaveBeenCalledTimes(2);
    expect(exec).toHaveBeenCalledWith([
      'sh', '-c', 'printf "%s\\n" "$1" > /proc/1/fd/1', 'sdk-smoke-log', marker,
    ]);
    expect(cancel).toHaveBeenCalledOnce();
  });

  test('reports a failed marker write and cancels the stream', async () => {
    const cancel = vi.fn();
    const sandbox = {
      runtime: { logs: { follow: () => new ReadableStream<RuntimeLogEntry>({ cancel }) } },
      exec: vi.fn(async () => ({ exitCode: 1, stdout: '', stderr: 'Permission denied' })),
    } as unknown as NotebookInstance;

    await expect(emitRuntimeLogMarker(sandbox, 'marker')).rejects.toThrow('Permission denied');
    expect(cancel).toHaveBeenCalledOnce();
  });

  test('rejects a stream that ends without delivering the marker', async () => {
    const follow = vi.fn(() => new ReadableStream<RuntimeLogEntry>({
      start(controller) { controller.close(); },
    }));
    const exec = vi.fn(async () => ({ exitCode: 0, stdout: '', stderr: '' }));
    const sandbox = { runtime: { logs: { follow } }, exec } as unknown as NotebookInstance;

    await expect(emitRuntimeLogMarker(sandbox, 'marker')).rejects.toThrow('ended before the marker arrived');
    expect(exec).toHaveBeenCalledOnce();
  });
});
