import { Action, Disposable, NotebookInstance } from './index.js';
import { nanoid } from 'nanoid';
export interface Task {
  id: string;
  command: string;
  kind: string;
  created: boolean;
}

export interface TerminalCreateInput {
  id: string;
  kind: string;
  size: [number, number];
  command?: string | string[];
  env?: Record<string, string>;
  cwd?: string;
}

export interface TerminalSpawnInput {
  command: string | string[];
  opts?: SpawnOptions;
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
  'terminal.start': Action;
  'terminal.create': Action<TerminalCreateInput, Task>;
  'terminal.spawn': Action<TerminalSpawnInput, Task>;
  'terminal.resize': Action<{ id: string; width: number; height: number }, boolean>;
  'terminal.close': Action<{ id: string }, boolean>;
}

export interface SandboxProcess {
  exit: Promise<number>;

  input: WritableStream<string>;

  output: ReadableStream<string>;

  kill(): void;

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

  abortSignal?: AbortSignal;
}

export default class Terminal {
  constructor(protected okra: NotebookInstance) {}

  public list() {
    return this.okra.invoke('terminal.list');
  }

  public start() {
    return this.okra.invoke('terminal.start');
  }

  public create(input: TerminalCreateInput) {
    return this.okra.invoke('terminal.create', input);
  }

  public onStarted(handler: (t: Task) => void): void {
    this.okra.listen('terminal.started', handler);
  }

  public resize(id: string, size: [number, number]) {
    return this.okra.invoke('terminal.resize', { id, width: size[0], height: size[1] });
  }

  public onOutput(id: string, handler: (data: TerminalEvents['terminal.output']) => void): void {
    this.okra.listen(`terminal.output.${id}`, handler);
  }

  public input(id: string, input: string) {
    return this.okra.invoke('terminal.input', { id, input });
  }

  public listen<T extends keyof TerminalEvents>(event: T, handler: (data: TerminalEvents[T]) => void): Disposable {
    return this.okra.listen(event, handler);
  }

  public async spawn(command: string, args: string[], opts?: SpawnOptions): Promise<SandboxProcess & Task> {
    const id = nanoid();
    const disposables = new Set<Disposable>();
    const dispose = () => {
      for (const disposable of disposables) {
        disposable.dispose();
      }
      disposables.clear();
    };

    const input = new WritableStream<string>({
      write: (chunk) => {
        this.input(id, chunk);
      },
      close: dispose,
    });

    const output = new ReadableStream<string>({
      start: (controller) => {
        disposables.add(
          this.listen(`terminal.output.${id}`, (data) => {
            controller.enqueue(data.output);
          })
        );
      },
      cancel: dispose,
    });

    const exit = new Promise<number>((resolve) => {
      disposables.add(
        this.listen(`terminal.close.${id}`, (data) => {
          dispose();
          resolve(data.exitCode);
        })
      );
    });

    const kill = () => {
      dispose();

      this.okra.invoke('terminal.close', { id });
    };

    const resize = (dimensions: { cols: number; rows: number }) => {
      this.okra.invoke('terminal.resize', { id, width: dimensions.cols, height: dimensions.rows });
    };

    const { abortSignal, ...otherOpts } = opts ?? {};
    if (abortSignal) {
      abortSignal.addEventListener('abort', kill);
    }

    const result = await this.okra.invoke('terminal.spawn', {
      command: [command, ...args],
      opts: {
        ...otherOpts,
        id,
      },
    });

    return {
      exit,
      input,
      output,
      kill,
      resize,
      ...result,
    };
  }
}
