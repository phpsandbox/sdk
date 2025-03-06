import {nanoid} from "nanoid";
import {ErrorEvent} from "../types";
import retry from "async-retry";
import ReconnectingWebSocket, { CloseEvent, ErrorEvent as WsErrorEvent } from "reconnecting-websocket";
import EventManager, { EventDispatcher } from "../events";
import { timeout } from "../utils/promise";

interface WsOptions {
    debug?: boolean;
}

export interface CallOption {
	responseEvent?: string;
	timeout?: number;
	retries?: number | false;
	buffer?: boolean;
}

export type WebSocketStatus = "OPEN" | "CONNECTING" | "CLOSED";

export enum SocketEvent {
	BootError = "Events.BootError",
	Response = "response",
	Error = "error",
	ClientId = "App.Actions.GetClientId",
}

export class Transport {
	private readonly eventEmitter: EventDispatcher;

	private clientId: string = "";

	private readonly sendingAsBinary: boolean = false;

	private closed = false;

    private readonly rws: ReconnectingWebSocket;

	public constructor(private readonly url: string, private readonly options: WsOptions = {}) {
        this.rws = new ReconnectingWebSocket(this.url, [], {
            WebSocket: WebSocket,
            connectionTimeout: 1000,
            maxReconnectionDelay: 2000,
            minReconnectionDelay: 200,
            maxEnqueuedMessages: 0,
        });

		this.eventEmitter = EventManager.make();
		this.sendingAsBinary = !options.debug;

		this.registerWatchers();
	}

	public id(): string {
		return this.clientId;
	}

	private async registerWatchers(): Promise<void> {
        this.rws.addEventListener("message", (e) => {
            this.handleRawMessage(e);
        });

		window.addEventListener("beforeunload", this.disconnect.bind(this));
		window.addEventListener("unload", this.disconnect.bind(this));
	}

    private async handleRawMessage(ev: MessageEvent<string | Blob | ArrayBuffer>): Promise<void> {
        let jsonText = ev.data;
        if (typeof jsonText === "string" && jsonText === "") {
            return;
        }

        if (jsonText instanceof ArrayBuffer) {
            jsonText = new TextDecoder().decode(jsonText);
        }

        if (jsonText instanceof Blob) {
            jsonText = await jsonText.text();
        }

        try {
            const {data, event, as} = JSON.parse(jsonText || "");
            if (event === SocketEvent.ClientId) {
                this.clientId = data.id;

                return;
            }

            if (event === SocketEvent.BootError) {
                return;
            }

            if (event === SocketEvent.Response) {
                // {"event":"response","data":{"responseEvent":"ping","data":"pong"}}
                const {responseEvent, data: responseData} = data;
                await this.handleMessage(responseEvent, responseData);

                return;
            }

            if (event === SocketEvent.Error) {
                // {"event":"error","data":{"errorEvent":"pingo_error","data":{"code":404,"message":"Action pingo not found"}}}
                const {errorEvent, data: responseData} = data;
                await this.handleMessage(errorEvent, responseData);

                return;
            }

            await this.handleMessage(event, data, as);
        } catch (e) {
            console.log("Failed to parse message", {jsonText, ev, e, data: ev});
            console.error(e);

            throw e;
        }
    }

	private async handleMessage(event: string, data: any, as?: string): Promise<any> {
		if (event === SocketEvent.ClientId) {
			this.clientId = data.id;
			this.eventEmitter.emit(event, data.id);

			return;
		}

		event && this.eventEmitter.emit(as || event, data);
	}

	public listen(event: string, listener: (data: any) => void, context?: any): void {
		this.eventEmitter.listen(event, listener);
	}

	public removeListener(event: string, listener?: (data: any) => void): void {
		this.eventEmitter.removeListener(event, listener);
	}

	public listenOnce(event: string, listener: (data: any) => void, context?: any): void {
		this.eventEmitter.once(event, listener, context);
	}

	public emit(event: string, ...data: any): void {
		this.eventEmitter.emit(event, ...data);
	}

	public send(action: string, data: object | string, buffer = true): boolean {
		this.rws.send(this.pack({action, data}));

        return true;
	}

	public get isConnected(): boolean {
		return this.status === "OPEN";
	}

	public get isConnecting(): boolean {
		return this.status === "CONNECTING";
	}

	public get isDisconnected(): boolean {
		return this.status === "CLOSED";
	}

	public get isClosed(): boolean {
		return this.closed;
	}

	public get status(): string|undefined {
		return {
            0: "CONNECTING",
            1: "OPEN",
            2: "CLOSING",
            3: "CLOSED",
        }[this.rws.readyState]
	}

	public async call(action: string, data: object | string = {}, options: CallOption = {}): Promise<any> {
		/**
		 * We only want to wait for response if the send is successful
		 */
		const responseEvent = options.responseEvent || `${action}_${nanoid()}_response`;
		const errorEvent = `${responseEvent}_error`;
		const brokenConnection = new Error("Connection lost to the notebook during request");

		let closeHandler: (ev: CloseEvent|WsErrorEvent) => void;
		const removeListeners = () => {
			if (closeHandler) {
				this.rws.removeEventListener("close", closeHandler);
                this.rws.removeEventListener("error", closeHandler);
			}

			this.eventEmitter.removeListener(responseEvent);
			this.eventEmitter.removeListener(errorEvent);
		};

		const handler = async (resolve, reject): Promise<void> => {
			this.listenOnce(responseEvent, resolve);
			this.listenOnce(errorEvent, (e) => reject(new ErrorEvent(e.code, e.message, e)));

			if (!this.isConnected) {
				reject(brokenConnection);

				return;
			}

			/**
			 * We will only reject if the connection is broken and not that the connection was closed
			 * by the user delibrately. This prevents unnecessary errors being thrown.
			 * A delibrate close, for example, is when the user closes the notebook or navigates away.
			 */
            closeHandler = (ev: CloseEvent|WsErrorEvent) => {
                reject(brokenConnection);
            };

            this.rws.addEventListener("close", closeHandler);
            this.rws.addEventListener("error", closeHandler);

			try {
				const retries = options.retries || 10;
				await this.sendWithRetry({action, data, errorEvent, responseEvent}, retries);
			} catch (e) {
				reject(e);
			}
		};

		const promise = new Promise(handler);
		if (!options.timeout) {
			return promise.finally(removeListeners);
		}

		return timeout(promise, options.timeout).finally(removeListeners);
	}

    private pack(data: string | ArrayBuffer | Blob | object): string | Blob | ArrayBuffer {
        if (typeof data === "object") {
            data = JSON.stringify(data);
        }

        return this.sendingAsBinary ? new Blob([data]) : data;
    }

	private async sendWithRetry(message: object, retries = 10): Promise<boolean> {
		return retry(
			async (bail, retries) => {
				/**
				 * We don't want to buffer the message if we are retrying so that we will
				 * not have same message sent multiple times to the server.
				 */
                this.rws.send(this.pack(message));
			},
			{
				retries,
				randomize: true,
				onRetry: (e: unknown) => {
					if (this.options.debug) {
						console.log("Retrying send", e);
					}
				},
			}
		);
	}

	public invoke(action: string, data: object | string = {}, options: CallOption = {}): Promise<any> {
		if (!options.responseEvent) {
			options.responseEvent = `${action}_${nanoid()}`;
		}

		return this.call("invoke", {action, data}, options);
	}

	public disconnect(): void {
		if (this.closed) {
			return;
		}

		this.close();
	}

	public close(code?: number, reason?: string): void {
        this.rws.close(code, reason);

		this.closed = true;
	}

    public onDidConnect(listener: () => void): void {
        this.rws.addEventListener("open", listener);
    }

    public onDidClose(listener: () => void): void {
        this.rws.addEventListener("close", listener);
    }

    private oncifyForSocket(listener: () => void, event: "open" | "close" | "error"): () => void {
        const handler = () => {
            Promise.resolve(listener()).then(() => {
                this.rws.removeEventListener(event, handler);
            });
        };

        return handler;
    }
}
