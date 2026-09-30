import type { NotebookInstance, RuntimeLogEntry, RuntimeStats } from '@phpsandbox/sdk';
import { describe, expect, test, vi } from 'vitest';
import { checkRuntimeLogSubscription } from '../support/runtime-logs.js';

function createTelemetryFixture(subscriptionError?: Error) {
  const cancelLogs = vi.fn();
  const cancelMetrics = vi.fn();
  const follow = vi.fn(() => new ReadableStream<RuntimeLogEntry>({ cancel: cancelLogs }));
  const watch = vi.fn(() => new ReadableStream<RuntimeStats>({
    start(controller) {
      if (subscriptionError) {
        controller.error(subscriptionError);
      } else {
        controller.enqueue({
          cpu: { usage: 0, limit: 100 },
          memory: { usage: 10, limit: 512 },
          disk: { usage: 0, limit: 1024 },
        });
      }
    },
    cancel: cancelMetrics,
  }));
  const sandbox = { runtime: { logs: { follow }, metrics: { watch } } } as unknown as NotebookInstance;
  return { sandbox, follow, watch, cancelLogs, cancelMetrics };
}

describe('runtime log subscription smoke', () => {
  test('subscribes and cancels both streams without requiring a runtime log', async () => {
    const fixture = createTelemetryFixture();

    await expect(checkRuntimeLogSubscription(fixture.sandbox)).resolves.toBeUndefined();
    expect(fixture.follow).toHaveBeenCalledOnce();
    expect(fixture.watch).toHaveBeenCalledOnce();
    expect(fixture.cancelLogs).toHaveBeenCalledOnce();
    expect(fixture.cancelMetrics).toHaveBeenCalledOnce();
  });

  test('reports subscription failures and still cancels the log stream', async () => {
    const fixture = createTelemetryFixture(new Error('Telemetry subscription failed'));

    await expect(checkRuntimeLogSubscription(fixture.sandbox)).rejects.toThrow('Telemetry subscription failed');
    expect(fixture.cancelLogs).toHaveBeenCalledOnce();
  });

  test('reports log stream failures rather than treating cancellation as success', async () => {
    const fixture = createTelemetryFixture();
    fixture.follow.mockImplementation(() => new ReadableStream<RuntimeLogEntry>({
      start(controller) { controller.error(new Error('Log subscription failed')); },
    }));

    await expect(checkRuntimeLogSubscription(fixture.sandbox)).rejects.toThrow('Log subscription failed');
    expect(fixture.cancelMetrics).toHaveBeenCalledOnce();
  });
});
