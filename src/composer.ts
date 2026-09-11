import type {
  Action,
  Client,
  ComposerCredentialInfo,
  ComposerCredentialInput,
  ComposerCredentialType,
  Disposable,
  NotebookInstance,
} from './index.js';
import {
  ProcessReadable,
  type ProcessOutputChunk,
  type ProcessOutputSource,
  type ProcessResult,
} from './shell.js';
import { nanoid } from 'nanoid';

export interface ComposerEventData {
  'composer.output': {
    id: string;
    output: string;
    source: ProcessOutputSource;
  };
}

type ComposerEventPattern = `${keyof ComposerEventData}.${string}`;
export type ComposerEvents = ComposerEventData & {
  [K in ComposerEventPattern]: ComposerEventData['composer.output'];
};

export interface ComposerPackage {
  name: string;
  _installedVersion: string;
  installationMode: 'require' | 'require-dev';
  _installed: boolean;
}

export interface ComposerActions {
  'composer.invoke': Action<
    { id: string; command: ComposerCommand; args: Argument; options: Options },
    ProcessResult
  >;
  'composer.kill': Action<{ id: string }, boolean>;
  'composer.packages': Action<undefined, ComposerPackage[]>;
}

export type ComposerCommand =
  | 'install'
  | 'update'
  | 'require'
  | 'remove'
  | 'search'
  | 'show'
  | 'dump-autoload';

export type Argument<Name extends string = string, Type extends string | string[] = string | string[]> = Record<Name, Type>;

export type Options<
  Name extends string = string,
  Type extends string | string[] | boolean = string | string[] | boolean,
> = Record<Name, Type>;

class ComposerCredentials {
  public constructor(
    private readonly client: Client,
    private readonly notebookId: string
  ) {}

  public async set(input: ComposerCredentialInput): Promise<ComposerCredentialInfo> {
    const response = await this.client.put<ComposerCredentialInfo>(
      `/notebook/${this.notebookId}/composer/credentials`,
      input
    );

    return response.data;
  }

  public async remove(type: ComposerCredentialType, url?: string): Promise<void> {
    const params = new URLSearchParams({ type });
    if (url) params.set('url', url);
    await this.client.delete<void>(`/notebook/${this.notebookId}/composer/credentials?${params.toString()}`);
  }
}

export class ComposerProcess {
  public readonly output: ReadableStream<ProcessOutputChunk>;
  public readonly stdout: ReadableStream<Uint8Array>;
  public readonly stderr: ReadableStream<Uint8Array>;
  private readonly completion: Promise<ProcessResult>;

  public constructor(
    public readonly id: string,
    private readonly okra: NotebookInstance,
    command: ComposerCommand,
    args: Argument,
    options: Options
  ) {
    const output = new ProcessReadable<ProcessOutputChunk>();
    const stdout = new ProcessReadable<Uint8Array>();
    const stderr = new ProcessReadable<Uint8Array>();
    this.output = output.stream;
    this.stdout = stdout.stream;
    this.stderr = stderr.stream;

    const encoder = new TextEncoder();
    let subscription: Disposable | null = this.okra.listen(`composer.output.${this.id}`, (event) => {
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

    this.completion = this.okra.invoke('composer.invoke', { id, command, args, options }).then((result) => {
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
    await this.okra.invoke('composer.kill', { id: this.id });
  }
}

export default class Composer {
  public readonly credentials: ComposerCredentials;

  public constructor(protected okra: NotebookInstance, client: Client) {
    this.credentials = new ComposerCredentials(client, okra.data.id);
  }

  public run(command: ComposerCommand, args: Argument = {}, options: Options = {}): ComposerProcess {
    return new ComposerProcess(nanoid(), this.okra, command, args, options);
  }

  public packages(): Promise<ComposerPackage[]> {
    return this.okra.invoke('composer.packages');
  }
}
