import { describe, expect, it, vi } from 'vitest';
import Logs from '../../src/log.js';
import Metrics from '../../src/metrics.js';
import Ports from '../../src/ports.js';
import { RuntimeTelemetry } from '../../src/telemetry.js';

class FakeNotebook {
  public readonly runtimeTransport = 'realtime';
  public readonly invoke = vi.fn(async (action: string) => {
    if (action === 'container.stats') {
      return {
        cpu: { usage: 5, limit: 100 },
        memory: { usage: 64, limit: 512 },
        disk: { usage: 10, limit: 1024 },
      };
    }
    if (action === 'container.opened-ports') {
      return [{ port: 8000, subdomain: 'app', url: 'https://app.test', default: true }];
    }
    if (action === 'container.resolve-port') {
      return { port: 4848, subdomain: 'app-4848', url: 'https://app-4848.test', default: false };
    }
  });
  private readonly listeners = new Map<string, Set<(data: any) => void>>();

  public listen(event: string, handler: (data: any) => void) {
    const listeners = this.listeners.get(event) ?? new Set();
    listeners.add(handler);
    this.listeners.set(event, listeners);
    return { dispose: () => listeners.delete(handler) };
  }

  public onDidConnect() {
    return { dispose: () => {} };
  }

  public emit(event: string, data: any): void {
    for (const listener of this.listeners.get(event) ?? []) {
      listener(data);
    }
  }
}

describe('Runtime observability', () => {
  it('multiplexes purposeful streams over the internal telemetry subscription', async () => {
    const notebook = new FakeNotebook();
    const telemetry = new RuntimeTelemetry(notebook as any);
    const logReader = new Logs(notebook as any, telemetry).follow().getReader();
    const metricsReader = new Metrics(notebook as any, telemetry).watch().getReader();

    await vi.waitFor(() => {
      expect(notebook.invoke).toHaveBeenCalledWith('container.stream-telemetry', {
        features: expect.arrayContaining(['logs', 'stats']),
      });
    });

    notebook.emit('notebook.log', 'ready');
    notebook.emit('container.stats', {
      cpu: { usage: 5, limit: 100 },
      memory: { usage: 64, limit: 512 },
      disk: { usage: 10, limit: 1024 },
    });

    await expect(logReader.read()).resolves.toMatchObject({
      done: false,
      value: { source: 'runtime', message: 'ready' },
    });
    await expect(metricsReader.read()).resolves.toMatchObject({
      done: false,
      value: { cpu: { usage: 5, limit: 100 } },
    });

    await logReader.cancel();
    await metricsReader.cancel();
    expect(notebook.invoke).toHaveBeenLastCalledWith('container.stop-telemetry');
  });

  it('provides current metrics and ports without starting a stream', async () => {
    const notebook = new FakeNotebook();
    const telemetry = new RuntimeTelemetry(notebook as any);
    const metrics = new Metrics(notebook as any, telemetry);
    const ports = new Ports(notebook as any, telemetry);

    await expect(metrics.current()).resolves.toMatchObject({ cpu: { usage: 5 } });
    await expect(ports.list()).resolves.toEqual([
      { port: 8000, subdomain: 'app', url: 'https://app.test', default: true },
    ]);
    await expect(ports.resolve(4848)).resolves.toEqual({
      port: 4848,
      subdomain: 'app-4848',
      url: 'https://app-4848.test',
      default: false,
    });
    expect(notebook.invoke).toHaveBeenLastCalledWith('container.resolve-port', { port: 4848 });
  });
});
