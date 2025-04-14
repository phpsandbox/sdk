import {Filesystem, FilesystemActions} from "./filesystem";
import Terminal, {TerminalEvents, TerminalActions} from "./terminal";
import Container, {ContainerActions, ContainerEvents} from "./container";
import Auth, {AuthActions} from "./auth";
import Lsp, {LspActions, LspEvents} from "./lsp";
import Composer, {ComposerActions, ComposerEvents} from "./composer";
import Log, {LogActions, LogEvents} from "./log";
import Laravel, {LaravelActions, LaravelEvents} from "./laravel";
import Repl, {ReplActions, ReplEvents} from "./repl";
import Shell, {ShellEvents, ShellActions} from "./shell";
import {Transport} from "./socket";
import axios, { AxiosInstance, AxiosRequestConfig } from "axios";
import EventManager, { EventDispatcher } from "./events";

export * from "./types";
export * from "./lsp";
export * from "./filesystem";
export * from "./container";
export * from "./shell";
export * from "./terminal";

interface Result<T extends object> {
    type: "success" | "error" | "running";
    message: string;
    data: T;
}

export interface NotebookActions {
    "notebook.init": Action<
        {force?: boolean; files: {[path: string]: string}},
        Result<{env: {name: string; value: string}[]; previewUrl: string}>
    >;
    "notebook.update": Action<null>;
}

export interface NotebookEvents {
    "lsp.response": object;
    "lsp.close": {code: number; reason: string};
    "init.event": {message: string};
    "notebook.initialized": null;
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
    ShellEvents;

interface SystemActions {
    ping: Action<object, "pong">;
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
        Accept: "application/json",
        Authorization: `Bearer ${token}`,
    },
});

export interface CreateNotebookInput {
    title: string;
    visibility: "public" | "private" | "unlisted";
}

class NotebookInitError extends Error {
    constructor(public message: string) {
        super(message);
    }
}

export class NotebookApi {
    public constructor(private readonly client: Client) {}

    public async create(template: string, input: Partial<CreateNotebookInput> = {}): Promise<NotebookInstance> {
        const response = await this.client.http.post<NotebookData>("/notebook", {template, ...input});

        return this.init(response.data);
    }

    public async fork(id: string): Promise<NotebookInstance> {
        const response = await this.client.http.post<NotebookData>(`/notebook/${id}/fork`);

        return this.init(response.data);
    }

    public async open(id: string): Promise<NotebookInstance> {
        const response = await this.client.http.get<NotebookData>(`/notebook/${id}`);

        return this.init(response.data);
    }

    public openFromData(data: NotebookData): Promise<NotebookInstance> {
        return this.init(data);
    }

    private async init(data: NotebookData): Promise<NotebookInstance> {
        const instance = new NotebookInstance(data, this.client);
        await instance.connected();

        const result = await instance.init();
        if (result.type === "error") {
            throw new NotebookInitError(result.message);
        }

        return instance;
    }
}

export interface PHPSandboxClientOptions {
    debug?: boolean;
}
export class Client {
    public readonly http: AxiosInstance;
    public readonly notebook: NotebookApi;
    public readonly options: PHPSandboxClientOptions;

	public constructor(token: string, url: string = "https://api.phpsandbox.io/v1", options: PHPSandboxClientOptions = {}) {
        this.http = axios.create(defaultAxiosConfig(url, token));
        this.notebook = new NotebookApi(this);
        this.options = options;
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

    public readonly socket: Transport;
    public readonly emitter: EventDispatcher;

    public initialized: NotebookActions['notebook.init']['response'] | false = false;

    public constructor(protected data: NotebookData, protected client: Client) {
        this.emitter = EventManager.createInstance();
        this.socket = new Transport(data.okraUrl, this.emitter, {
            debug: client.options.debug
        });
        this.watchConnection();

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

    public fork(): Promise<NotebookInstance> {
        return this.client.notebook.fork(this.data.id);
    }

    public stop(): Promise<void> {
        return this.container.stop();
    }

    public restart(): Promise<void> {
        return this.container.start();
    }

    public async call<T extends keyof Invokable>(
		action: T,
		data: Invokable[T]["args"] = {},
		options: CallOption = {}
	): Promise<Invokable[T]["response"]> {
        const result = await this.ensureInitialized();
        if (result.type === "error") {
            throw new NotebookInitError(result.message);
        }

		return this.socket.call(action, data || {}, options);
	}

	public async invoke<T extends keyof Invokable>(
		action: T,
		data: Invokable[T]["args"] = {},
		options: CallOption = {}
	): Promise<Invokable[T]["response"]> {
        const result = await this.ensureInitialized();
        if (result.type === "error") {
            throw new NotebookInitError(result.message);
        }

		return this.socket.invoke(action, data || {}, options);
	}

    private async ensureInitialized(files: {[path: string]: string} = {}) {
        await this.connected();

        if (!this.initialized) {
            this.initialized = (await this.socket.invoke("notebook.init", {files})) as NotebookActions['notebook.init']['response'];
        }

        return this.initialized;
    }

    public ping() {
        return this.invoke("ping");
    }

	public listen<T extends keyof Events>(event: T, handler: (data: Events[T]) => void) {
		return this.socket.listen(event as string, handler);
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
                this.socket.onDidClose(() => reject(new Error("Connection closed")));
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
            this.socket.emit("okra.connected");
        });

        this.socket.onDidClose(() => {
            this.socket.emit("okra.disconnected");
            this.initialized = false;
        });
	}

	public onDidConnect(handler: () => void): void {
		this.socket.removeListener("okra.connected", handler);
		this.socket.listen("okra.connected", handler);
	}

	public onDidDisconnect(handler: () => void): void {
		this.socket.listen("okra.disconnected", handler);
	}

    public async init(files: {[path: string]: string} = {}) {
        return this.ensureInitialized(files);
	}

	public update() {
		return this.invoke("notebook.update");
	}

	public onDidInitialize(handler: () => void) {
		this.listen("notebook.initialized", handler);
	}
}
