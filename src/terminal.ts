import { Action, Disposable, NotebookInstance } from './index.js';
import { nanoid } from 'nanoid';
import { once } from './utils/promise.js';

const TERMINAL_INPUT_FLUSH_DELAY_MS = 8;
const terminalInputFlushPattern = /[\x00-\x1f\x7f]/;

export interface Task {
  id: string;
  command: string | string[];
  kind: string;
  created: boolean;
  cwd?: string;
  tty?: boolean;
  running?: boolean;
  exitCode?: number | null;
}

export interface TerminalCreateInput {
  id: string;
  kind: string;
  size: [number, number];
  command?: string | string[];
  env?: Record<string, string | number | boolean>;
  cwd?: string;
}

export interface TerminalEventData {
  'terminal.output': {
    output: string;
    id: string;
  };
  'terminal.started': Task;
  'terminal.stopped': Task & { exitCode: number };
  'terminal.close': Task & { exitCode: number };
}

type PrefixKey<K extends keyof TerminalEventData> = `${K}.${string}`;
type TerminalEventPattern = PrefixKey<keyof TerminalEventData>;
export type TerminalEvents = TerminalEventData & {
  [K in TerminalEventPattern]: K extends `terminal.output.${string}`
    ? TerminalEventData['terminal.output']
    : Task & { exitCode: number };
};

export interface TerminalActions {
  'terminal.input': Action<{ id: string; input: string }>;
  'terminal.list': Action<{}, Task[]>;
  'terminal.create': Action<TerminalCreateInput, Task>;
  'terminal.attach': Action<{ id: string; replayHistory?: boolean }, Task | false>;
  'terminal.resize': Action<{ id: string; width: number; height: number }, boolean>;
  'terminal.close': Action<{ id: string }, boolean>;
}

export interface SandboxProcess {
  wait(): Promise<number>;

  input: WritableStream<string | Uint8Array>;

  output: ReadableStream<string>;

  kill(): Promise<boolean>;

  resize(dimensions: { cols: number; rows: number }): void;
}

export interface SpawnOptions {
  cwd?: string;

  env?: Record<string, string | number | boolean>;

  output?: boolean;

  terminal?: {
    cols: number;
    rows: number;
  };

  id?: string;
  osc?: boolean;
  tty?: boolean;

  abortSignal?: AbortSignal;
}

export interface TerminalOptions {
  command?: string | string[];
  args?: string[];
  kind?: string;
  size?: [number, number];
  cwd?: string;
  env?: Record<string, string | number | boolean>;
  id?: string;
  osc?: boolean;
  tty?: boolean;
  abortSignal?: AbortSignal;
}

export default class Terminals {
  constructor(protected okra: NotebookInstance) {}

  public list() {
    return this.okra.invoke('terminal.list');
  }

  public async create(options: TerminalOptions = {}): Promise<SandboxProcess & Task> {
    const id = options.id ?? nanoid();
    const handle = this.processHandle(id, options.abortSignal);
    const command = typeof options.command === 'string' && options.args?.length
      ? [options.command, ...options.args]
      : options.command;
    const { abortSignal, args: _args, ...input } = options;

    try {
      const task = await this.okra.invoke(
        'terminal.create',
        {
          ...input,
          id,
          kind: options.kind ?? 'bash',
          size: options.size ?? [80, 24],
          command,
        },
        { abortSignal }
      );

      return { ...handle.process, ...task };
    } catch (error) {
      handle.dispose();
      throw error;
    }
  }

  public async attach(id: string, opts?: { replayHistory?: boolean; abortSignal?: AbortSignal }): Promise<(SandboxProcess & Task) | false> {
    const handle = this.processHandle(id, opts?.abortSignal);

    try {
      const task = await this.okra.invoke(
        'terminal.attach',
        {
          id,
          replayHistory: opts?.replayHistory,
        },
        { abortSignal: opts?.abortSignal }
      );

      if (!task) {
        handle.dispose();
        return false;
      }

      return {
        ...handle.process,
        ...task,
      };
    } catch (error) {
      handle.dispose();
      throw error;
    }
  }

  private processHandle(id: string, abortSignal?: AbortSignal): { process: SandboxProcess; dispose: () => void } {
    const disposables = new Set<Disposable>();
    let abortHandler: (() => void) | undefined;

    const dispose = () => {
      if (abortHandler) {
        abortSignal?.removeEventListener('abort', abortHandler);
        abortHandler = undefined;
      }

      for (const disposable of disposables) {
        disposable.dispose();
      }
      disposables.clear();
    };

    let pendingInput = '';
    let inputFlushTimer: ReturnType<typeof setTimeout> | undefined;

    const flushInput = () => {
      if (inputFlushTimer) {
        clearTimeout(inputFlushTimer);
        inputFlushTimer = undefined;
      }

      if (pendingInput === '') {
        return;
      }

      const input = pendingInput;
      pendingInput = '';
      void this.okra.send('terminal.input', { id, input });
    };

    const scheduleInputFlush = () => {
      if (inputFlushTimer) {
        return;
      }

      inputFlushTimer = setTimeout(flushInput, TERMINAL_INPUT_FLUSH_DELAY_MS);
    };

    const queueInput = (value: string | Uint8Array) => {
      const chunk = typeof value === 'string' ? value : new TextDecoder().decode(value);
      pendingInput += chunk;

      if (terminalInputFlushPattern.test(chunk)) {
        flushInput();
        return;
      }

      scheduleInputFlush();
    };

    const disposeInput = () => {
      flushInput();
      dispose();
    };

    const input = new WritableStream<string | Uint8Array>({
      write: queueInput,
      close: disposeInput,
      abort: disposeInput,
    });

    let controller: ReadableStreamDefaultController<string> | null = null;
    const output = new ReadableStream<string>({
      start: (_controller) => {
        controller = _controller;
        disposables.add(
          this.okra.listen(`terminal.output.${id}`, (data) => {
            controller?.enqueue(data.output);
          })
        );
      },
      cancel: () => {
        controller = null;
        disposeInput();
      },
    });

    const completion = new Promise<number>((resolve) => {
      disposables.add(
        this.okra.listen(`terminal.close.${id}`, (data) => {
          if (controller) {
            try {
              controller.close();
            } catch {
              // Ignore close errors after cancellation.
            }
          }

          disposeInput();
          resolve(data.exitCode);
        })
      );
    });

    const kill = once(() => {
      disposeInput();
      return this.okra.invoke('terminal.close', { id });
    });

    const resize = (dimensions: { cols: number; rows: number }) => {
      this.okra.invoke('terminal.resize', { id, width: dimensions.cols, height: dimensions.rows });
    };

    if (abortSignal && !abortSignal.aborted) {
      abortHandler = () => {
        void kill();
      };
      abortSignal.addEventListener('abort', abortHandler, { once: true });
    }

    return {
      process: {
        wait: () => completion,
        input,
        output,
        kill,
        resize,
      },
      dispose: disposeInput,
    };
  }
}
