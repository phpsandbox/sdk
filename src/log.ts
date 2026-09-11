import type { NotebookInstance } from './index.js';
import { RuntimeTelemetry, type RuntimeWatchOptions, watchRuntimeTelemetry } from './telemetry.js';

export interface LogEvents {
  'notebook.log': string;
}

export interface RuntimeLogEntry {
  timestamp: string;
  source: 'runtime';
  message: string;
}

export default class Logs {
  public constructor(
    protected okra: NotebookInstance,
    private readonly telemetry: RuntimeTelemetry
  ) {}

  public follow(options: RuntimeWatchOptions = {}): ReadableStream<RuntimeLogEntry> {
    return watchRuntimeTelemetry(this.okra, this.telemetry, 'logs', 'notebook.log', (message: string) => ({
      timestamp: new Date().toISOString(),
      source: 'runtime',
      message,
    }), options);
  }
}
