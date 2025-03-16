import {Filesystem, FilesystemActions} from "./filesystem";
import Terminal, {TerminalEvents, TerminalActions} from "./terminal";
import Container, {ContainerActions, ContainerEvents} from "./container";
import Auth, {AuthActions} from "./auth";
import Lsp, {LspActions, LspEvents} from "./lsp";
import Composer, {ComposerActions, ComposerEvents} from "./composer";
import Log, {LogActions, LogEvents} from "./log";
import Laravel, {LaravelActions, LaravelEvents} from "./laravel";
import Notebook, {NotebookActions, NotebookEvents} from "./notebook";
import Repl, {ReplActions, ReplEvents} from "./repl";
import Shell, {ShellEvents, ShellActions} from "./shell";
import {Transport} from "./socket";

export * from "./types";
export * from "./lsp";
export * from "./filesystem";
export * from "./container";
export * from "./shell";

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

export default class Okra {
	public readonly file: Filesystem;
	public readonly terminal: Terminal;
	public readonly auth: Auth;
	public readonly lsp: Lsp;
	public readonly composer: Composer = new Composer(this);
	public readonly log: Log = new Log(this);
	public readonly notebook: Notebook;
	public readonly repl: Repl;
	public readonly container: Container = new Container(this);
	public readonly laravel: Laravel = new Laravel(this);
    public readonly shell: Shell;

	private static instance?: Okra;

    public readonly socket: Transport;

	private constructor(url: string) {
        this.socket = new Transport(url);
		this.watchConnection();

		this.file = new Filesystem(this);
		this.terminal = new Terminal(this);
		this.auth = new Auth(this);
		this.lsp = new Lsp(this);
		this.notebook = new Notebook(this);
		this.repl = new Repl(this);
        this.shell = new Shell(this);
	}

	public call<T extends keyof Invokable>(
		action: T,
		data: Invokable[T]["args"] = {},
		options: CallOption = {}
	): Promise<Invokable[T]["response"]> {
		return this.socket.call(action, data || {}, options);
	}

	public invoke<T extends keyof Invokable>(
		action: T,
		data: Invokable[T]["args"] = {},
		options: CallOption = {}
	): Promise<Invokable[T]["response"]> {
		return this.socket.invoke(action, data || {}, options);
	}

    public ping() {
        return this.invoke("ping");
    }

	public listen<T extends keyof Events>(event: T, handler: (data: Events[T]) => void): void {
		this.socket.listen(event as string, handler);
	}

	public static createInstance(url: string, fresh: boolean = false): Okra {
		if (fresh || !this.instance) {
			this.instance = new Okra(url);
		}

		return this.instance;
	}

	public static getInstance(): Okra | undefined {
		return this.instance;
	}

	public static dispose(): void {
		if (this.instance) {
			this.instance.socket.disconnect();
		}

		this.instance = undefined;
	}

	public connected(): Promise<Okra> {
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

	public whenConnected(): Promise<Okra> {
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
        this.socket.onDidConnect(() => this.socket.emit("okra.connected"));

        this.socket.onDidClose(() => this.socket.emit("okra.disconnected"));
	}

	public onDidConnect(handler: () => void): void {
		this.socket.removeListener("okra.connected", handler);

		this.socket.listen("okra.connected", handler);
	}

	public onDidDisconnect(handler: () => void): void {
		this.socket.listen("okra.disconnected", handler);
	}
}
