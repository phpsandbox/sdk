import {nanoid} from "nanoid";
import { encode, decode } from "@msgpack/msgpack";
import {ErrorEvent} from "../types.js";
import retry from "async-retry";
import ReconnectingWebSocket, { CloseEvent, ErrorEvent as WsErrorEvent } from "reconnecting-websocket";
import { EventDispatcher } from "../events/index.js";
import { timeout } from "../utils/promise.js";
import WebSocket from "isomorphic-ws";

interface WsOptions {
    debug?: boolean;
    startClosed?: boolean;
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
	private clientId: string = "";

	private closed = false;

  // @ts-expect-error
  private readonly rws: ReconnectingWebSocket;

	public constructor(private readonly url: string, private readonly eventEmitter: EventDispatcher, private readonly options: WsOptions = {}) {
    // @ts-expect-error
        this.rws = new ReconnectingWebSocket(this.url, [], {
            WebSocket,
            connectionTimeout: 1000,
            maxReconnectionDelay: 2000,
            minReconnectionDelay: 200,
            maxEnqueuedMessages: 0,
            startClosed: options.startClosed,
        });

		this.registerWatchers();
	}

	public id(): string {
		return this.clientId;
	}

	private async registerWatchers(): Promise<void> {
        this.rws.addEventListener("message", (ev: MessageEvent) => {
            if (!(ev.data instanceof Blob)) {
                throw new Error("Unexpected message type: " + typeof ev.data);
            }

            ev.data.arrayBuffer().then((buffer: ArrayBuffer) => {
                this.handleRawMessage(decode(buffer));
            });
        });
	}

    private async handleRawMessage(ev: unknown): Promise<void> {
        if (typeof ev !== "object" || ev === null) {
            return;
        }

        try {
            const {data, event, as} = ev as {data: any, event: string, as: string};
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
            console.log("Failed to parse message", {ev, e, data: ev});
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

	public listen(event: string, listener: (data: any) => void, _context?: any) {
		return this.eventEmitter.listen(event, listener);
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
        }[this.rws.readyState as unknown as number]
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

		const handler = async (resolve: (value: any) => void, reject: (reason?: any) => void): Promise<void> => {
			this.listenOnce(responseEvent, resolve);
			this.listenOnce(errorEvent, (e) => reject(new ErrorEvent(e.code, e.message, e)));

			/**
			 * We will only reject if the connection is broken and not that the connection was closed
			 * by the user delibrately. This prevents unnecessary errors being thrown.
			 * A delibrate close, for example, is when the user closes the notebook or navigates away.
			 */
            closeHandler = (_ev: CloseEvent|WsErrorEvent) => {
                reject(brokenConnection);
            };

            this.rws.addEventListener("close", closeHandler);
            this.rws.addEventListener("error", closeHandler);

			try {
				const retries = options.retries || 10;
				this.sendWithRetry({action, data, errorEvent, responseEvent}, retries);
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
        return new Blob([encode(data)]);
    }

	private sendWithRetry(message: object, retries = 10): void {
		retry(
			(_bail: (error: Error) => void, _retries: number) => {
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
}
