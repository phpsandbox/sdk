import type { Action, Disposable, NotebookInstance } from './index.js';
import type { SpawnOptions } from './terminal.js';
import { nanoid } from 'nanoid';

export type ProcessOutputSource = 'output' | 'stdout' | 'stderr';

export interface ProcessOutputChunk {
  source: ProcessOutputSource;
  data: Uint8Array;
}

export interface ShellEventData {
  'shell.output': {
    output: string;
    source: ProcessOutputSource;
    id: string;
  };
}

type PrefixKey<K extends keyof ShellEventData> = `${K}.${string}`;
type ShellEventPattern = PrefixKey<keyof ShellEventData>;
export type ShellEvents = ShellEventData & {
  [K in ShellEventPattern]: ShellEventData['shell.output'];
};

export interface ShellExecInput {
  command: string | string[];
  opts?: Omit<SpawnOptions, 'abortSignal'>;
}

export interface ShellActions {
  'shell.exec': Action<ShellExecInput, ProcessResult>;
  'shell.input': Action<{ id: string; input: string }, boolean>;
  'shell.kill': Action<{ id: string }, boolean>;
}

export interface ProcessResult {
  output: string;
  stdout: string;
  stderr: string;
  exitCode: number;
}

function resolveRunInput(command: string | string[], argsOrOpts: string[] | SpawnOptions = [], opts?: SpawnOptions) {
  const args = Array.isArray(argsOrOpts) ? argsOrOpts : [];
  const resolvedOpts = Array.isArray(argsOrOpts) ? opts : argsOrOpts;

  return {
    command: Array.isArray(command) ? command : args.length > 0 ? [command, ...args] : command,
    opts: { tty: false, ...resolvedOpts },
  };
}

export class ProcessReadable<T> {
  public readonly stream: ReadableStream<T>;
  private controller: ReadableStreamDefaultController<T> | null = null;
  private closed = false;

  public constructor() {
    this.stream = new ReadableStream<T>({
      start: (controller) => {
        this.controller = controller;
      },
      cancel: () => {
        this.closed = true;
        this.controller = null;
      },
    });
  }

  public enqueue(value: T): void {
    if (!this.closed) {
      this.controller?.enqueue(value);
    }
  }

  public close(): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.controller?.close();
    this.controller = null;
  }

  public fail(error: unknown): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.controller?.error(error);
    this.controller = null;
  }
}

export class ShellProcess {
  public readonly output: ReadableStream<ProcessOutputChunk>;
  public readonly stdout: ReadableStream<Uint8Array>;
  public readonly stderr: ReadableStream<Uint8Array>;
  public readonly stdin: WritableStream<Uint8Array | string>;
  private readonly completion: Promise<ProcessResult>;

  public constructor(
    public readonly id: string,
    private readonly okra: NotebookInstance,
    command: string | string[],
    opts: SpawnOptions
  ) {
    const output = new ProcessReadable<ProcessOutputChunk>();
    const stdout = new ProcessReadable<Uint8Array>();
    const stderr = new ProcessReadable<Uint8Array>();
    this.output = output.stream;
    this.stdout = stdout.stream;
    this.stderr = stderr.stream;
    this.stdin = new WritableStream<Uint8Array | string>({
      write: async (chunk) => {
        const input = typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk);
        const written = await this.okra.invoke('shell.input', { id: this.id, input });
        if (!written) {
          throw new Error(`Process ${this.id} is not accepting input`);
        }
      },
    });

    const encoder = new TextEncoder();
    let subscription: Disposable | null = this.okra.listen(`shell.output.${this.id}`, (event) => {
      const data = encoder.encode(event.output);
      const source = event.source ?? 'output';
      output.enqueue({ source, data });
      if (source === 'stderr') {
        stderr.enqueue(data);
      } else {
        stdout.enqueue(data);
      }
    });

    const finish = () => {
      subscription?.dispose();
      subscription = null;
      output.close();
      stdout.close();
      stderr.close();
    };
    const fail = (error: unknown) => {
      subscription?.dispose();
      subscription = null;
      output.fail(error);
      stdout.fail(error);
      stderr.fail(error);
    };
    const { abortSignal, ...payloadOpts } = opts;
    this.completion = this.okra.invoke(
      'shell.exec',
      { command, opts: { ...payloadOpts, id: this.id } },
      { abortSignal }
    ).then((result) => {
      finish();
      return result;
    }).catch((error) => {
      fail(error);
      throw error;
    });
  }

  public wait(): Promise<ProcessResult> {
    return this.completion;
  }

  public async kill(): Promise<void> {
    await this.okra.invoke('shell.kill', { id: this.id });
  }
}

export default class Shell {
  public constructor(protected readonly okra: NotebookInstance) {}

  public run(command: string | string[], opts?: SpawnOptions): ShellProcess;
  public run(command: string, args: string[], opts?: SpawnOptions): ShellProcess;
  public run(command: string | string[], argsOrOpts: string[] | SpawnOptions = [], opts?: SpawnOptions): ShellProcess {
    const input = resolveRunInput(command, argsOrOpts, opts);
    const id = input.opts?.id ?? nanoid();

    return new ShellProcess(id, this.okra, input.command, { ...input.opts, id });
  }
}
