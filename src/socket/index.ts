import { nanoid } from 'nanoid';
import { encode, decode } from '@msgpack/msgpack';
import { Disposable, ErrorEvent, RateLimitError } from '../types.js';
import retry from 'async-retry';
import ReconnectingWebSocket, { CloseEvent, ErrorEvent as WsErrorEvent } from 'reconnecting-websocket';
import { EventDispatcher } from '../events/index.js';
import { timeout } from '../utils/promise.js';
import WebSocket from 'isomorphic-ws';

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

export type WebSocketStatus = 'OPEN' | 'CONNECTING' | 'CLOSED';

export enum SocketEvent {
  BootError = 'Events.BootError',
  Response = 'response',
  Error = 'error',
  ClientId = 'App.Actions.GetClientId',
}

export class Transport {
  private readonly PING_INTERVAL = 30000;

  private pingInterval: ReturnType<typeof setInterval> | null = null;

  private clientId: string = '';

  private closed = false;

  // @ts-expect-error
  private readonly rws: ReconnectingWebSocket;

  private disposables: Disposable[] = [];

  private connectPromise: Promise<void> | null = null;

  private readonly url: URL;

  public constructor(
    url: string,
    private readonly eventEmitter: EventDispatcher,
    private readonly options: WsOptions = {}
  ) {
    this.url = new URL(url);
    this.url.searchParams.set('sdk_version', '0.0.1');

    // Always start closed by default (lazy initialization)
    const startClosed = options.startClosed !== false;

    // @ts-expect-error
    this.rws = new ReconnectingWebSocket(this.url.toString(), [], {
      WebSocket,
      maxEnqueuedMessages: 0,
      maxRetries: 50,
      startClosed,
    });

    this.registerWatchers();
  }

  /**
   * Explicitly connect to the websocket if not already connected
   * Used for lazy initialization
   *
   * This method ensures only one connection attempt happens at a time
   * by caching the connection promise.
   */
  #connect(): Promise<void> {
    if (this.isConnected) {
      return Promise.resolve();
    }

    // Return existing connection promise if one is already in progress
    if (this.connectPromise) {
      return this.connectPromise;
    }

    // Create and cache the connection promise
    this.connectPromise = new Promise((resolve, reject) => {
      // Check if connection is already open after potential reconnect
      if (this.isConnected) {
        resolve();
        this.#startPeriodicPing();
        return;
      }

      // Open the connection if it's closed
      if (this.rws.readyState === 3) {
        this.rws.reconnect();
      }

      let timeoutId: ReturnType<typeof setTimeout>;

      const openHandler = () => {
        this.rws.removeEventListener('open', openHandler);
        this.rws.removeEventListener('error', errorHandler);
        clearTimeout(timeoutId);

        // Clear the cached promise on success
        this.connectPromise = null;
        resolve();
        this.#startPeriodicPing();
      };

      const errorHandler = (error: Event) => {
        this.rws.removeEventListener('open', openHandler);
        this.rws.removeEventListener('error', errorHandler);
        clearTimeout(timeoutId);

        // Clear the cached promise on error so retry is possible
        this.connectPromise = null;
        reject(new Error(`WebSocket connection failed: ${error}`));
      };

      // Add timeout to prevent hanging forever
      timeoutId = setTimeout(() => {
        this.rws.removeEventListener('open', openHandler);
        this.rws.removeEventListener('error', errorHandler);

        // Clear the cached promise on timeout so retry is possible
        this.connectPromise = null;
        reject(new Error('WebSocket connection timeout'));
      }, 10000); // 10 second timeout

      this.rws.addEventListener('open', openHandler);
      this.rws.addEventListener('error', errorHandler);
    });

    return this.connectPromise;
  }

  #startPeriodicPing(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
    }

    this.pingInterval = setInterval(() => {
      this.invoke('ping');
    }, this.PING_INTERVAL);
  }

  public id(): string {
    return this.clientId;
  }

  private async registerWatchers(): Promise<void> {
    this.rws.addEventListener('message', (ev: MessageEvent) => {
      if (!(ev.data instanceof Blob)) {
        throw new Error('Unexpected message type: ' + typeof ev.data);
      }

      ev.data.arrayBuffer().then((buffer: ArrayBuffer) => {
        this.handleRawMessage(decode(buffer));
      });
    });

    this.disposables.push({
      dispose: () => {
        this.rws.removeEventListener('message');
      },
    });
  }

  private async handleRawMessage(ev: unknown): Promise<void> {
    if (typeof ev !== 'object' || ev === null) {
      return;
    }

    try {
      const { data, event, as } = ev as { data: any; event: string; as: string };
      if (event === SocketEvent.ClientId) {
        this.clientId = data.id;

        return;
      }

      if (event === SocketEvent.BootError) {
        return;
      }

      if (event === SocketEvent.Response) {
        // {"event":"response","data":{"responseEvent":"ping","data":"pong"}}
        const { responseEvent, data: responseData } = data;
        await this.handleMessage(responseEvent, responseData);

        return;
      }

      if (event === SocketEvent.Error) {
        // {"event":"error","data":{"errorEvent":"pingo_error","data":{"code":404,"message":"Action pingo not found"}}}
        const { errorEvent, data: responseData } = data;
        await this.handleMessage(errorEvent, responseData);

        return;
      }

      await this.handleMessage(event, data, as);
    } catch (e) {
      console.error('Failed to parse message', { ev, e, data: ev });

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
    return this.status === 'OPEN';
  }

  public get isConnecting(): boolean {
    return this.status === 'CONNECTING';
  }

  public get isDisconnected(): boolean {
    return this.status === 'CLOSED';
  }

  public get isClosed(): boolean {
    return this.closed;
  }

  public get status(): string | undefined {
    return {
      0: 'CONNECTING',
      1: 'OPEN',
      2: 'CLOSING',
      3: 'CLOSED',
    }[this.rws.readyState as unknown as number];
  }

  public async call(action: string, data: object | string = {}, options: CallOption = {}): Promise<any> {
    const responseEvent = options.responseEvent || `${action}_${nanoid()}_response`;
    const errorEvent = `${responseEvent}_error`;

    let closeHandler: (ev: CloseEvent | WsErrorEvent) => void;
    const removeListeners = () => {
      if (closeHandler) {
        this.rws.removeEventListener('close', closeHandler);
        this.rws.removeEventListener('error', closeHandler);
      }

      this.eventEmitter.removeListener(responseEvent);
      this.eventEmitter.removeListener(errorEvent);
    };

    const handler = async (resolve: (value: any) => void, reject: (reason?: any) => void): Promise<void> => {
      this.listenOnce(responseEvent, resolve);
      this.listenOnce(errorEvent, (e) => reject(new ErrorEvent(e.code, e.message, e)));

      closeHandler = (_ev: (CloseEvent | WsErrorEvent) & { reason?: string; code?: number }) => {
        if (_ev.code === 1008 && (_ev.reason || '').includes('rate limit')) {
          reject(new RateLimitError(_ev.reason || 'Rate limit exceeded', _ev));

          return;
        }
        reject(new Error(`Connection lost to the notebook during request: ${_ev.reason || 'Unknown reason'}`));
      };

      this.rws.addEventListener('close', closeHandler);
      this.rws.addEventListener('error', closeHandler);

      this.rws.send(this.pack({ action, data, errorEvent, responseEvent }));
    };

    const send = async () => {
      // Ensure connection is established before making calls
      await this.#connect();

      const promise = new Promise(handler).finally(removeListeners);
      if (!options.timeout) {
        return promise;
      }

      return timeout(promise, options.timeout).finally(removeListeners);
    };

    return this.sendWithRetry(async () => await send(), options.retries || 10);
  }

  private pack(data: string | ArrayBuffer | Blob | object): string | Blob | ArrayBuffer {
    return new Blob([encode(data)]);
  }

  private sendWithRetry(sender: () => Promise<any>, retries = 10): Promise<any> {
    /**
     * There is the question that, since the retry is happening on the same connection,
     * how then do we make sure the retry mechanism is smart enough to not be trying to resend
     * on a dead connection?
     */
    return retry(
      async (bail: (error: Error) => void, _retries: number) => {
        try {
          return await sender();
        } catch (e) {
          if (e instanceof ErrorEvent || e instanceof RateLimitError) {
            bail(e);

            return;
          }

          throw e;
        }
      },
      {
        retries,
        onRetry: (e: unknown) => {
          if (this.options.debug) {
            console.log('Retrying send', e);
          }
        },
        minTimeout: 500,
      }
    );
  }

  public invoke(action: string, data: object | string = {}, options: CallOption = {}): Promise<any> {
    if (!options.responseEvent) {
      options.responseEvent = `${action}_${nanoid()}`;
    }

    return this.call('invoke', { action, data }, options);
  }

  public disconnect(): void {
    if (this.closed) {
      return;
    }

    this.close();
  }

  public close(code?: number, reason?: string): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
    }

    // Clear any pending connection promise
    this.connectPromise = null;

    this.disposables.forEach((d) => d.dispose());
    this.rws.close(code, reason);

    this.closed = true;
  }

  public onDidConnect(listener: () => void): void {
    this.rws.addEventListener('open', listener);
    this.disposables.push({
      dispose: () => {
        this.rws.removeEventListener('open', listener);
      },
    });
  }

  public onDidClose(listener: (e: CloseEvent | WsErrorEvent) => void): void {
    this.rws.addEventListener('close', listener);
    this.disposables.push({
      dispose: () => {
        this.rws.removeEventListener('close', listener);
      },
    });
  }
}
