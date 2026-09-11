import type { Action, NotebookInstance } from './index.js';
import Logs, { type RuntimeLogEntry } from './log.js';
import Metrics from './metrics.js';
import Ports from './ports.js';
import {
  RuntimeTelemetry,
  type RuntimeTelemetryFeature,
  type RuntimeWatchOptions,
} from './telemetry.js';

export interface PortInfo {
  subdomain: string;
  url: string;
  default: boolean;
  localPort?: number;
  externalPort?: number;
  port: number;
}

export interface RuntimeResourceUsage {
  usage: number;
  limit: number;
}

export interface RuntimeStats {
  cpu: RuntimeResourceUsage;
  memory: RuntimeResourceUsage;
  disk: RuntimeResourceUsage;
}

export interface RuntimeEvents {
  'container.stats': RuntimeStats;
  'container.ports': PortInfo[];
}

export interface RuntimeActions {
  'container.restart': Action<{}, void>;
  'container.stop': Action<{}, void>;
  'container.opened-ports': Action<{}, PortInfo[]>;
  'container.resolve-port': Action<{ port: number }, PortInfo>;
  'container.stats': Action<{}, RuntimeStats | null>;
  'container.set-php': Action<{ version: string }, { version: string }>;
  'container.stream-telemetry': Action<{ features: RuntimeTelemetryFeature[] }, void>;
  'container.stop-telemetry': Action<{}, void>;
}

export class RuntimeMetrics {
  public constructor(private readonly metrics: Metrics) {}

  public current(): Promise<RuntimeStats | null> {
    return this.metrics.current();
  }

  public watch(options: RuntimeWatchOptions = {}): ReadableStream<RuntimeStats> {
    return this.metrics.watch(options);
  }
}

export class RuntimeLogs {
  public constructor(private readonly logs: Logs) {}

  public follow(options: RuntimeWatchOptions = {}): ReadableStream<RuntimeLogEntry> {
    return this.logs.follow(options);
  }
}

export class RuntimePorts {
  public constructor(private readonly ports: Ports) {}

  public list(): Promise<PortInfo[]> {
    return this.ports.list();
  }

  public resolve(port: number): Promise<PortInfo> {
    return this.ports.resolve(port);
  }

  public watch(options: RuntimeWatchOptions = {}): ReadableStream<PortInfo[]> {
    return this.ports.watch(options);
  }
}

export default class Runtime {
  public readonly metrics: RuntimeMetrics;
  public readonly logs: RuntimeLogs;
  public readonly ports: RuntimePorts;

  public constructor(private readonly notebook: NotebookInstance) {
    const telemetry = new RuntimeTelemetry(notebook);
    this.metrics = new RuntimeMetrics(new Metrics(notebook, telemetry));
    this.logs = new RuntimeLogs(new Logs(notebook, telemetry));
    this.ports = new RuntimePorts(new Ports(notebook, telemetry));
  }

  public setPhpVersion(version: string): Promise<{ version: string }> {
    return this.notebook.invoke('container.set-php', { version });
  }
}
