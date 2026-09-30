import type { NotebookInstance } from '@phpsandbox/sdk';
import { expect } from 'vitest';
import { operation } from './resources.js';

export async function checkRuntimeLogSubscription(sandbox: NotebookInstance): Promise<void> {
  const logs = sandbox.runtime.logs.follow().getReader();
  const metrics = sandbox.runtime.metrics.watch().getReader();

  try {
    const metric = await operation('wait for runtime telemetry subscription', () => metrics.read(), 30_000);
    expect(metric.done).toBe(false);
    expect(metric.value).toEqual(expect.objectContaining({ cpu: expect.any(Object), memory: expect.any(Object) }));
    await logs.cancel();
  } finally {
    try {
      await metrics.cancel();
    } finally {
      await logs.cancel();
    }
  }
}
