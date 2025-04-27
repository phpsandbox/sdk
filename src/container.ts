import { Action, Disposable, NotebookInstance } from './index.js';

interface Stat {
  usage: number;
  limit: number;
}

export interface ContainerStats {
  cpu: Stat;
  memory: Stat;
  disk: Stat;
}

export enum NotebookState {
  RUNNING = 'running',
  STOPPED = 'stopped',
  STARTING = 'starting',
  STOPPING = 'stopping',
  KILLED = 'killed',
  ERROR = 'error',
  PROVISIONING = 'provisioning',
}

export interface ContainerEvents {
  'container.stats': ContainerStats;
}

export interface PortInfo {
  subdomain: string;
  url: string;
  default: boolean;
  port: number;
}

export interface ContainerActions {
  'container.start': Action<{}, void>;
  'container.stop': Action<{}, void>;
  'container.state': Action<{}, { state: NotebookState }>;
  'container.opened-ports': Action<{}, PortInfo[]>;
  'container.set-php': Action<{ version: string }, { version: string }>;
}

export default class Container {
  constructor(protected okra: NotebookInstance) {}

  public start() {
    return this.okra.invoke('container.start');
  }

  public stop() {
    return this.okra.invoke('container.stop');
  }

  public state() {
    return this.okra.invoke('container.state');
  }

  public openedPorts() {
    return this.okra.invoke('container.opened-ports');
  }

  public setPhp(version: string) {
    return this.okra.invoke('container.set-php', { version });
  }

  public listen<T extends keyof ContainerEvents>(
    event: T,
    handler: (data: ContainerEvents[T]) => void
  ): void {
    this.okra.listen(event, handler);
  }

  public onPort(handler: (port: PortInfo, type: 'open' | 'close') => void): Disposable {
    let ports: PortInfo[] = [];
    const id = setInterval(async () => {
      const newPorts = await this.openedPorts();
      for (const port of newPorts) {
        if (!ports.some((p) => p.port === port.port)) {
          handler(port, 'open');
        }
      }
      for (const port of ports) {
        if (!newPorts.some((p) => p.port === port.port)) {
          handler(port, 'close');
        }
      }
      ports = newPorts;
    }, 2000);

    return { dispose: () => clearInterval(id) };
  }
}
