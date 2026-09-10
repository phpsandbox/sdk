import type { Disposable, NotebookInstance } from './index.js';

export type RuntimeTelemetryFeature = 'stats' | 'logs' | 'ports';

export interface RuntimeWatchOptions {
  signal?: AbortSignal;
}

export class RuntimeTelemetry {
  private readonly references = new Map<RuntimeTelemetryFeature, number>();
  private synchronization: Promise<void> = Promise.resolve();

  public constructor(private readonly okra: NotebookInstance) {
    if (okra.runtimeTransport === 'realtime') {
      okra.onDidConnect(() => {
        if (this.references.size > 0) {
          void this.synchronize();
        }
      });
    }
  }

  public async acquire(feature: RuntimeTelemetryFeature): Promise<() => Promise<void>> {
    this.references.set(feature, (this.references.get(feature) ?? 0) + 1);

    try {
      await this.synchronize();
    } catch (error) {
      this.removeReference(feature);
      throw error;
    }

    let released = false;
    return async () => {
      if (released) {
        return;
      }

      released = true;
      this.removeReference(feature);
      await this.synchronize();
    };
  }

  private removeReference(feature: RuntimeTelemetryFeature): void {
    const references = this.references.get(feature) ?? 0;
    if (references <= 1) {
      this.references.delete(feature);
    } else {
      this.references.set(feature, references - 1);
    }
  }

  private synchronize(): Promise<void> {
    this.synchronization = this.synchronization.catch(() => {}).then(async () => {
      const features = Array.from(this.references.keys());
      if (features.length === 0) {
        await this.okra.invoke('container.stop-telemetry');
      } else {
        await this.okra.invoke('container.stream-telemetry', { features });
      }
    });

    return this.synchronization;
  }
}

export function watchRuntimeTelemetry<T>(
  okra: NotebookInstance,
  telemetry: RuntimeTelemetry,
  feature: RuntimeTelemetryFeature,
  event: 'container.stats' | 'container.ports' | 'notebook.log',
  transform: (data: any) => T,
  options: RuntimeWatchOptions = {}
): ReadableStream<T> {
  let subscription: Disposable | null = null;
  let release: (() => Promise<void>) | null = null;
  let closed = false;
  let abort: (() => void) | null = null;

  const stop = async () => {
    if (closed) {
      return;
    }

    closed = true;
    subscription?.dispose();
    subscription = null;
    if (abort && options.signal) {
      options.signal.removeEventListener('abort', abort);
    }
    abort = null;
    await release?.();
    release = null;
  };

  return new ReadableStream<T>({
    start(controller) {
      subscription = okra.listen(event, (data) => {
        if (!closed) {
          controller.enqueue(transform(data));
        }
      });

      if (options.signal) {
        abort = () => {
          void stop().finally(() => controller.error(options.signal?.reason ?? new Error('Aborted')));
        };
        if (options.signal.aborted) {
          abort();
          return;
        }
        options.signal.addEventListener('abort', abort, { once: true });
      }

      void telemetry.acquire(feature).then(async (releaseTelemetry) => {
        if (closed) {
          await releaseTelemetry();
          return;
        }
        release = releaseTelemetry;
      }).catch((error) => {
        if (!closed) {
          closed = true;
          subscription?.dispose();
          if (abort && options.signal) {
            options.signal.removeEventListener('abort', abort);
          }
          abort = null;
          controller.error(error);
        }
      });
    },
    cancel: stop,
  });
}
