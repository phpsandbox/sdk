import type { NotebookInstance, RuntimeLogEntry } from '@phpsandbox/sdk';
import { expect } from 'vitest';
import { operation } from './resources.js';

export async function emitRuntimeLogMarker(sandbox: NotebookInstance, marker: string): Promise<RuntimeLogEntry> {
  const logs = sandbox.runtime.logs.follow().getReader();
  let pending = logs.read();
  const deadline = Date.now() + 30_000;

  try {
    while (Date.now() < deadline) {
      const emitted = await operation('emit runtime log marker', () => sandbox.exec([
        'sh', '-c', 'printf "%s\\n" "$1" > /proc/1/fd/1', 'sdk-smoke-log', marker,
      ]), Math.max(1, deadline - Date.now()));
      expect(emitted.exitCode, emitted.stderr).toBe(0);

      while (Date.now() < deadline) {
        const entry = await Promise.race([
          pending,
          new Promise<undefined>((resolve) => setTimeout(resolve, Math.min(250, deadline - Date.now()))),
        ]);
        if (entry === undefined) {
          break;
        }
        if (entry.done) {
          throw new Error('Runtime log stream ended before the marker arrived.');
        }
        if (entry.value.message.includes(marker)) {
          return entry.value;
        }
        pending = logs.read();
      }
    }
    throw new Error('Runtime log marker did not arrive within 30000ms.');
  } finally {
    await logs.cancel();
  }
}
