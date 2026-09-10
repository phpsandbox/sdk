import type { NotebookInstance } from './index.js';
import type { PortInfo } from './runtime.js';
import { RuntimeTelemetry, type RuntimeWatchOptions, watchRuntimeTelemetry } from './telemetry.js';

export default class Ports {
  public constructor(
    private readonly okra: NotebookInstance,
    private readonly telemetry: RuntimeTelemetry
  ) {}

  public list(): Promise<PortInfo[]> {
    return this.okra.invoke('container.opened-ports');
  }

  public resolve(port: number): Promise<PortInfo> {
    return this.okra.invoke('container.resolve-port', { port });
  }

  public watch(options: RuntimeWatchOptions = {}): ReadableStream<PortInfo[]> {
    return watchRuntimeTelemetry(this.okra, this.telemetry, 'ports', 'container.ports', (ports) => ports, options);
  }
}
