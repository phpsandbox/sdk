import { Action, Disposable, NotebookInstance } from './index.js';
import { nanoid } from 'nanoid';
import { once } from './utils/promise.js';

export type NotebookServiceKind = 'app' | 'web' | 'cache' | 'task';
export type NotebookServiceSource = 'built_in' | 'setup_task';
export type NotebookServiceState =
  | 'running'
  | 'starting'
  | 'stopping'
  | 'backoff'
  | 'exited'
  | 'fatal'
  | 'stopped'
  | 'unknown';

export const notebookBuiltinServices = ['redis'] as const;
export type NotebookBuiltinServiceName = (typeof notebookBuiltinServices)[number];

export const notebookKnownServices = ['start', 'nginx', ...notebookBuiltinServices] as const;
export type NotebookKnownServiceName = (typeof notebookKnownServices)[number];
export type NotebookServiceName = NotebookKnownServiceName | (string & {});

export interface NotebookServiceStatus {
  name: string;
  displayName: string;
  kind: NotebookServiceKind;
  source: NotebookServiceSource;
  state: NotebookServiceState;
  description: string;
  running: boolean;
  pid: number | null;
  uptimeSeconds: number | null;
}

export interface ServiceLogEventData {
  'service.log': {
    name: string;
    output: string;
  };
}

type PrefixKey<K extends keyof ServiceLogEventData> = `${K}.${string}`;
type ServiceLogEventPattern = PrefixKey<keyof ServiceLogEventData>;
export type ServiceEvents = ServiceLogEventData & {
  [K in ServiceLogEventPattern]: ServiceLogEventData['service.log'];
};

export interface ServiceLogsInput {
  name: NotebookServiceName;
  tail?: number;
  follow?: boolean;
  id?: string;
}

export type NotebookServiceCommand = string | string[];

export interface ServiceActions {
  'service.list': Action<{}, NotebookServiceStatus[]>;
  'service.run': Action<{ name: NotebookServiceName; command?: NotebookServiceCommand }, NotebookServiceStatus>;
  'service.stop': Action<{ name: NotebookServiceName }, NotebookServiceStatus>;
  'service.logs': Action<ServiceLogsInput, { output: string } | { streaming: true; id: string }>;
  'service.stop-logs': Action<{ id: string }, boolean>;
}

export interface ServiceLogStreamOptions {
  tail?: number;
  follow: true;
  id?: string;
}

export interface ServiceLogOptions {
  tail?: number;
  follow?: false;
}

export default class Services {
  constructor(protected okra: NotebookInstance) {}

  public list() {
    return this.okra.invoke('service.list');
  }

  public run(name: NotebookServiceName, command?: NotebookServiceCommand) {
    return this.okra.invoke('service.run', {
      name,
      command,
    });
  }

  public stop(name: NotebookServiceName) {
    return this.okra.invoke('service.stop', { name });
  }

  public logs(name: NotebookServiceName, options: ServiceLogStreamOptions): ReadableStream<string>;
  public logs(name: NotebookServiceName, options?: ServiceLogOptions): Promise<string>;
  public logs(
    name: NotebookServiceName,
    options: ServiceLogOptions | ServiceLogStreamOptions = {}
  ): Promise<string> | ReadableStream<string> {
    if (options.follow) {
      return this.followLogs(name, options);
    }

    return this.okra
      .invoke('service.logs', {
        name,
        tail: options.tail,
      })
      .then((response) => {
        if (!('output' in response)) {
          throw new Error(`Unexpected service.logs response for ${name}`);
        }

        return response.output;
      });
  }

  private followLogs(name: NotebookServiceName, options: ServiceLogStreamOptions): ReadableStream<string> {
    const id = options.id || nanoid();
    const disposables = new Set<Disposable>();
    let controller: ReadableStreamDefaultController<string> | null = null;
    let closed = false;

    const dispose = () => {
      for (const disposable of disposables) {
        disposable.dispose();
      }

      disposables.clear();
    };

    const close = () => {
      if (closed) {
        return;
      }

      closed = true;
      dispose();

      if (controller) {
        try {
          controller.close();
        } catch {
          // Ignore close errors after cancellation.
        }
      }
    };

    const fail = (error: unknown) => {
      if (closed) {
        return;
      }

      closed = true;
      dispose();

      if (controller) {
        controller.error(error);
      }
    };

    const stop = once(() => {
      close();
      return this.okra.invoke('service.stop-logs', { id });
    });

    return new ReadableStream<string>({
      start: (_controller) => {
        controller = _controller;
        disposables.add(
          this.okra.listen(`service.log.${id}`, (data) => {
            controller?.enqueue(data.output);
          })
        );

        void this.okra
          .invoke('service.logs', {
            name,
            tail: options.tail,
            follow: true,
            id,
          })
          .catch((error) => {
            fail(error);
          });
      },
      cancel: () => {
        return stop().then(() => undefined);
      },
    });

  }
}
