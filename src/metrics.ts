import type { NotebookInstance } from './index.js';
import type { RuntimeStats } from './runtime.js';
import { RuntimeTelemetry, type RuntimeWatchOptions, watchRuntimeTelemetry } from './telemetry.js';

export default class Metrics {
  public constructor(
    private readonly okra: NotebookInstance,
    private readonly telemetry: RuntimeTelemetry
  ) {}

  public current(): Promise<RuntimeStats | null> {
    return this.okra.invoke('container.stats');
  }

  public watch(options: RuntimeWatchOptions = {}): ReadableStream<RuntimeStats> {
    return watchRuntimeTelemetry(this.okra, this.telemetry, 'stats', 'container.stats', (stats) => stats, options);
  }
}
