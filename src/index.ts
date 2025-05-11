import { Filesystem, FilesystemActions, FilesystemEvents } from './filesystem.js';
import Terminal, { TerminalEvents, TerminalActions } from './terminal.js';
import Container, { ContainerActions, ContainerEvents } from './container.js';
import Auth, { AuthActions } from './auth.js';
import Lsp, { LspActions, LspEvents } from './lsp.js';
import Composer, { ComposerActions, ComposerEvents } from './composer.js';
import Log, { LogActions, LogEvents } from './log.js';
import Laravel, { LaravelActions, LaravelEvents } from './laravel.js';
import Repl, { ReplActions, ReplEvents } from './repl.js';
import Shell, { ShellEvents, ShellActions } from './shell.js';
import { Transport } from './socket/index.js';
import axios, { AxiosInstance, AxiosRequestConfig } from 'axios';
import EventManager, { EventDispatcher } from './events/index.js';

export * from './types.js';
export * from './lsp.js';
export * from './filesystem.js';
export * from './container.js';
export * from './shell.js';
export * from './terminal.js';

interface Result<T extends object> {
  type: 'success' | 'error' | 'running';
  message: string;
  data: T;
}

type NotebookInitResult = Result<{ env: { name: string; value: string }[]; previewUrl: string }>;
export interface NotebookActions {
  'notebook.init': Action<{ force?: boolean; files: { [path: string]: string } }, NotebookInitResult>;
  'notebook.update': Action<null>;
}

export interface NotebookEvents {
  'lsp.response': object;
  'lsp.close': { code: number; reason: string };
  'init.event': { message: string };
  'notebook.initialized': NotebookInitResult;
}

export interface CallOption {
  responseEvent?: string;
  timeout?: number;
}

export interface OkraError {
  code: number;
  message: string;
}

export interface Action<Args = object, Response = null> {
  args: Args;
  response: Response;
}

export type Events = TerminalEvents &
  ContainerEvents &
  LspEvents &
  ComposerEvents &
  LogEvents &
  LaravelEvents &
  NotebookEvents &
  ReplEvents &
  ShellEvents &
  FilesystemEvents;

interface SystemActions {
  ping: Action<object, 'pong'>;
}

export type Invokable = SystemActions &
  TerminalActions &
  ContainerActions &
  FilesystemActions &
  AuthActions &
  LspActions &
  LaravelActions &
  ComposerActions &
  LogActions &
  NotebookActions &
  ReplActions &
  ShellActions;

const defaultAxiosConfig = (baseURL: string, token: string): AxiosRequestConfig => ({
  /**
   * withCredentials must be false so that `Allow-Control-Allow-Origin` header is set to `*`
   * This is required for the PHPSandbox API to work in the browser.
   */
  withCredentials: false,
  timeout: 30000,
  baseURL,
  headers: {
    Accept: 'application/json',
    Authorization: `Bearer ${token}`,
  },
});

export interface CreateNotebookInput {
  title: string;
  visibility: 'public' | 'private' | 'unlisted';
}

export class NotebookInitError extends Error {
  constructor(public message: string) {
    super(message);
  }
}

export class NotebookApi {
  public constructor(private readonly client: Client) {}

  public async create(template: string, input: Partial<CreateNotebookInput> = {}, init = true): Promise<NotebookInstance> {
    const response = await this.client.http.post<NotebookData>('/notebook', { template, ...input });
    const instance = new NotebookInstance(response.data, this.client);

    if (!init) {
      return instance;
    }

    return this.init(instance);
  }

  public async get(id: string): Promise<NotebookInstance> {
    const response = await this.client.http.get<NotebookData>(`/notebook/${id}`);

    return new NotebookInstance(response.data, this.client);
  }

  public async fork(id: string): Promise<NotebookInstance> {
    const response = await this.client.http.post<NotebookData>(`/notebook/${id}/fork`);

    return this.init(new NotebookInstance(response.data, this.client));
  }

  public async open(id: string): Promise<NotebookInstance> {
    const response = await this.client.http.get<NotebookData>(`/notebook/${id}`);

    return this.init(new NotebookInstance(response.data, this.client));
  }

  public openFromData(data: NotebookData): Promise<NotebookInstance> {
    return this.init(new NotebookInstance(data, this.client));
  }

  private init(instance: NotebookInstance): Promise<NotebookInstance> {
    return instance.ready();
  }
}

export interface PHPSandboxClientOptions {
  debug?: boolean;
  startClosed?: boolean;
}
export class Client {
  public readonly http: AxiosInstance;
  public readonly notebook: NotebookApi;
  public readonly options: PHPSandboxClientOptions;

  public constructor(token: string, url: string = 'https://api.phpsandbox.io/v1', options: PHPSandboxClientOptions = {}) {
    this.http = axios.create(defaultAxiosConfig(url, token));
    this.notebook = new NotebookApi(this);
    this.options = Object.assign({startClosed: true}, options);
  }
}

export class PHPSandbox extends Client {}

export interface NotebookData {
  id: string;
  okraUrl: string;
}

export class NotebookInstance {
  public readonly file: Filesystem;
  public readonly terminal: Terminal;
  public readonly auth: Auth;
  public readonly lsp: Lsp;
  public readonly composer: Composer;
  public readonly log: Log;
  public readonly repl: Repl;
  public readonly container: Container;
  public readonly laravel: Laravel;
  public readonly shell: Shell;

  private readonly socket: Transport;
  public readonly emitter: EventDispatcher;

  public initialized: NotebookActions['notebook.init']['response'] | false = false;

  #initPromise: Promise<NotebookInitResult>;

  public constructor(
    public readonly data: NotebookData,
    protected client: Client
  ) {
    this.emitter = EventManager.createInstance();
    this.socket = new Transport(data.okraUrl, this.emitter, {
      debug: client.options.debug,
      startClosed: client.options.startClosed,
    });
    this.watchConnection();

    this.#initPromise = this.#init();

    this.file = new Filesystem(this);
    this.terminal = new Terminal(this);
    this.auth = new Auth(this);
    this.lsp = new Lsp(this);
    this.composer = new Composer(this);
    this.log = new Log(this);
    this.repl = new Repl(this);
    this.container = new Container(this);
    this.laravel = new Laravel(this);
    this.shell = new Shell(this);
  }

  public async ready(): Promise<NotebookInitResult> {
    /**
     * If ready is called, we will try to ping the backend so as to force the
     * socket to connect if it hasn't already done that.
     */
    if (this.client.options.startClosed) {
        /**
         * We are using the socket directly instead of invoke so we don't
         * cause a case of circular dependency.
         */
        await this.socket.invoke('ping');
    }

    return this.#initPromise;
  }

  public fork(): Promise<NotebookInstance> {
    return this.client.notebook.fork(this.data.id);
  }

  public stop(): Promise<void> {
    return this.container.stop();
  }

  public restart(): Promise<void> {
    return this.container.start();
  }

  public async invoke<T extends keyof Invokable>(
    action: T,
    data: Invokable[T]['args'] = {},
    options: CallOption = {}
  ): Promise<Invokable[T]['response']> {
    await this.#initPromise;

    return this.socket.invoke(action, data || {}, options);
  }

  public ping() {
    return this.invoke('ping');
  }

  public listen<T extends keyof Events>(event: T, handler: (data: Events[T]) => void) {
    return this.emitter.listen(event as string, handler);
  }

  public dispose(): void {
    this.socket.disconnect();
  }

  public connected(): Promise<NotebookInstance> {
    if (this.socket.isConnected) {
      return Promise.resolve(this);
    }

    return new Promise((resolve, reject) => {
      try {
        this.socket.onDidConnect(() => resolve(this));
        this.socket.onDidClose(() => reject(new Error('Connection closed')));
      } catch (e) {
        reject(e);
      }
    });
  }

  public whenConnected(): Promise<NotebookInstance> {
    if (this.socket.isConnected) {
      return Promise.resolve(this);
    }

    return new Promise((resolve, reject) => {
      try {
        this.socket.onDidConnect(() => resolve(this));
      } catch (e) {
        reject(e);
      }
    });
  }

  private watchConnection(): void {
    this.socket.onDidConnect(() => {
      this.socket.emit('okra.connected');
    });

    this.socket.onDidClose(() => {
      this.socket.emit('okra.disconnected');
      this.initialized = false;
    });
  }

  public onDidConnect(handler: () => void): void {
    this.socket.removeListener('okra.connected', handler);
    this.socket.listen('okra.connected', handler);
  }

  public onDidDisconnect(handler: () => void): void {
    this.socket.listen('okra.disconnected', handler);
  }

  #init(): Promise<NotebookInitResult> {
    return new Promise<NotebookInitResult>((resolve, reject) => {
      this.onDidInitialize((result: NotebookInitResult) => {
        this.initialized = result;
        if (result.type === 'error') {
          reject(new NotebookInitError(result.message));
        }

        resolve(result);
      });
    });
  }

  public update() {
    return this.invoke('notebook.update');
  }

  public onDidInitialize(handler: (result: NotebookInitResult) => void) {
    this.listen('notebook.initialized', handler);
  }
}
