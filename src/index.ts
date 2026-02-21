import { Filesystem, FilesystemActions, FilesystemEvents } from './filesystem.js';
import Terminal, { TerminalEvents, TerminalActions } from './terminal.js';
import Container, { ContainerActions, ContainerEvents, PortInfo, TelemetryFeature } from './container.js';
import Auth, { AuthActions } from './auth.js';
import Lsp, { LspActions, LspEvents } from './lsp.js';
import Composer, { ComposerActions, ComposerEvents } from './composer.js';
import Log, { LogActions, LogEvents } from './log.js';
import Laravel, { LaravelActions, LaravelEvents } from './laravel.js';
import Repl, { ReplActions, ReplEvents } from './repl.js';
import Shell, { ShellEvents, ShellActions } from './shell.js';
import { Transport } from './socket/index.js';
import EventManager, { EventDispatcher } from './events/index.js';
import Git, { GitActions, GitEvents } from './git.js';
import { Disposable } from './types.js';
import { Beacon, BeaconOptions, createBeacon } from './beacon/index.js';

export * from './types.js';
export { Transport } from './socket/index.js';
export * from './lsp.js';
export * from './filesystem.js';
export * from './container.js';
export * from './shell.js';
export * from './terminal.js';
export * from './git.js';
export * from './utils/promise.js';
export * from './beacon/index.js';
export * from './errors/index.js';

interface Result<T extends object> {
  type: 'success' | 'error' | 'running';
  message: string;
  data: T;
}

export type NotebookInitResponse = { env: { name: string; value: string }[]; previewUrl: string; ports: PortInfo[] };

export type NotebookInitResult = Result<NotebookInitResponse>;
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
  abortSignal?: AbortSignal;
}

export interface OkraError {
  code: number;
  message: string;
}

export interface Action<Args = object, Response = void> {
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
  FilesystemEvents &
  GitEvents;

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
  ShellActions &
  GitActions;

export interface CreateNotebookInput {
  title: string;
  visibility: 'public' | 'private' | 'unlisted';
}

export class NotebookInitError extends Error {
  constructor(public readonly message: string) {
    super(message);
  }
}

export class ApiError extends Error {
  public readonly status: number;

  constructor(
    public readonly response: Response,
    public readonly body: string
  ) {
    super(`PHPSandbox API Error: ${response.status} ${response.statusText} - ${body}`);
    this.status = response.status;
  }
}

export class NotebookApi {
  public constructor(private readonly client: Client) {}

  public async create(template: string, input: Partial<CreateNotebookInput> = {}, init = true): Promise<NotebookInstance> {
    const response = await this.client.post<NotebookData>('/notebook', { template, ...input });
    const instance = new NotebookInstance(response.data, this.client);

    if (!init) {
      return instance;
    }

    return this.init(instance);
  }

  public async get(id: string): Promise<NotebookInstance> {
    const response = await this.client.get<NotebookData>(`/notebook/${id}`);

    return new NotebookInstance(response.data, this.client);
  }

  public async delete(id: string): Promise<void> {
    await this.client.delete<void>(`/notebook/${id}`);
  }

  public async fork(id: string): Promise<NotebookInstance> {
    const response = await this.client.post<NotebookData>(`/notebook/${id}/fork`);

    return this.init(new NotebookInstance(response.data, this.client));
  }

  public async open(id: string): Promise<NotebookInstance> {
    const response = await this.client.get<NotebookData>(`/notebook/${id}`);

    return new NotebookInstance(response.data, this.client);
  }

  public openFromData(data: NotebookData): Promise<NotebookInstance> {
    return this.init(new NotebookInstance(data, this.client));
  }

  private async init(instance: NotebookInstance): Promise<NotebookInstance> {
    await instance.ready();

    return instance;
  }
}

export interface PHPSandboxClientOptions {
  debug?: boolean;
  startClosed?: boolean;
  telemetry?: Set<TelemetryFeature>;
  fetch?: typeof globalThis.fetch;
}

export class Client {
  public readonly notebook: NotebookApi;
  public readonly options: PHPSandboxClientOptions;

  private readonly fetch: typeof globalThis.fetch = globalThis.fetch;

  private readonly baseUrl: string;

  private readonly headers: Record<string, string>;

  public constructor(token: string, url: string = 'https://api.phpsandbox.io/v1', options: PHPSandboxClientOptions = {}) {
    this.notebook = new NotebookApi(this);
    this.options = Object.assign({ startClosed: true }, options);
    this.baseUrl = url;

    if (options.fetch) {
      this.fetch = options.fetch;
    }

    this.headers = {
      'Accept': 'application/json',
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    };
  }

  public get<T extends unknown>(path: string): Promise<{ data: T }> {
    return this.makeRequest('GET', path);
  }

  public post<T extends unknown>(path: string, body?: unknown): Promise<{ data: T }> {
    return this.makeRequest('POST', path, { body: body ? JSON.stringify(body) : undefined });
  }

  public delete<T extends unknown>(path: string): Promise<{ data: T }> {
    return this.makeRequest('DELETE', path);
  }

  private async makeRequest(method: string, path: string, init?: RequestInit) {
    const response = await this.fetch(
      new Request(new URL(`v1/${path.replace(/^\//, '')}`, this.baseUrl), {
        method,
        ...init,
        headers: this.headers,
      })
    );

    if (!response.ok) {
      throw new ApiError(response, await response.text());
    }

    return { data: await response.json() };
  }
}

export class PHPSandbox extends Client {}

export interface NotebookData {
  id: string;
  okraUrl: string;
  type: string;
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
  public readonly git: Git;
  private readonly socket: Transport;
  public readonly emitter: EventDispatcher;

  public initialized: NotebookActions['notebook.init']['response'] | false = false;

  #initPromise: Promise<NotebookInitResult>;

  private readonly disposables: Disposable[] = [];

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
    this.git = new Git(this);
  }

  public async ready(): Promise<NotebookInitResult> {
    const ready = async () => {
      /**
       * If ready is called, we will try to ping the backend so as to force the
       * socket to connect if it hasn't already done that.
       */
      if (this.client.options.startClosed && !this.socket.isConnected) {
        /**
         * We are using the socket directly instead of invoke so we don't
         * cause a case of circular dependency.
         */
        await this.socket.invoke('ping');
      }

      return this.#initPromise;
    };

    // Let the underlying ReconnectingWebSocket handle connection retries
    // Just apply a reasonable timeout for the entire initialization process
    return ready();
  }

  public fork(): Promise<NotebookInstance> {
    return this.client.notebook.fork(this.data.id);
  }

  public delete(): Promise<void> {
    return this.client.notebook.delete(this.data.id);
  }

  public stop(): Promise<void> {
    return this.container.stop();
  }

  public restart(): Promise<void> {
    return this.container.start();
  }

  public invoke<T extends keyof Invokable>(
    action: T,
    data: Invokable[T]['args'] = {},
    options: CallOption = {}
  ): Promise<Invokable[T]['response']> {
    return this.socket.invoke(action, data || {}, options);
  }

  public ping() {
    return this.invoke('ping');
  }

  public listen<T extends keyof Events>(event: T, handler: (data: Events[T]) => void) {
    return this.emitter.listen(event as string, handler);
  }

  public dispose(): void {
    this.disposables.forEach((d) => d.dispose());
    !this.socket.isClosed && this.socket.disconnect();
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
      if (this.client.options.telemetry) {
        this.container.enableTelemetry(this.client.options.telemetry);
      }
    });

    this.socket.onDidClose(() => {
      this.socket.emit('okra.disconnected');
      this.initialized = false;
    });
  }

  public onDidConnect(handler: () => void): Disposable {
    this.socket.removeListener('okra.connected', handler);

    const disposable = this.socket.listen('okra.connected', handler);
    this.disposables.push(disposable);

    return disposable;
  }

  public onDidDisconnect(handler: () => void): Disposable {
    const disposable = this.socket.listen('okra.disconnected', handler);
    this.disposables.push(disposable);

    return disposable;
  }

  #init(): Promise<NotebookInitResult> {
    // Reset init promise for reconnection scenarios
    this.#initPromise = new Promise<NotebookInitResult>((resolve, reject) => {
      this.onDidInitialize((result: NotebookInitResult) => {
        this.initialized = result;
        if (result.type === 'error') {
          reject(new NotebookInitError(result.message));
        }

        resolve(result);
      });
    });
    
    return this.#initPromise;
  }

  public update() {
    return this.invoke('notebook.update');
  }

  public onDidInitialize(handler: (result: NotebookInitResult) => void) {
    const disposable = this.listen('notebook.initialized', handler);
    this.disposables.push(disposable);

    return disposable;
  }

  public async reconnect(): Promise<NotebookInstance> {
    const whenConnected = this.whenConnected();
    // Use the socket's reconnect method which preserves listeners
    // and uses the underlying ReconnectingWebSocket mechanism
    this.socket.reconnect();

    // Reset initialization state
    this.initialized = false;

    // Wait for the socket to reconnect
    await whenConnected;

    // Re-initialize the notebook
    this.#init();
    
    // Wait for initialization to complete
    return this.ready().then(() => this);
  }

  public async beacon(iframe: HTMLIFrameElement, options?: BeaconOptions): Promise<Beacon> {
    const result = await this.ready();
    iframe.src = result.data.previewUrl;
    return createBeacon(iframe, options);
  }
}
