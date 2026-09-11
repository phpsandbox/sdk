import { nanoid } from 'nanoid';
import { encode, decode } from '@msgpack/msgpack';
import {
  PromiseTimeoutError,
  RemoteError,
  SendTimeoutError,
  TransportError,
  remoteError,
} from '../errors/index.js';
import { retry } from '../utils/retry.js';
import * as ReconnectingWebSocketModule from 'reconnecting-websocket';
import type {
  CloseEvent as ReconnectingWebSocketCloseEvent,
  ErrorEvent as ReconnectingWebSocketErrorEvent,
} from 'reconnecting-websocket';
import { EventDispatcher } from '../events/index.js';
import { timeout } from '../utils/promise.js';
import { describeWebSocketEvent } from '../utils/websocket.js';
import WebSocket from 'isomorphic-ws';
import { NamedDisposable } from '../utils/disposable.js';

type ReconnectingWebSocketConstructor = typeof import('reconnecting-websocket').default;
type ReconnectingWebSocketInstance = InstanceType<ReconnectingWebSocketConstructor>;
type TransportUrlProvider = string | (() => string) | (() => Promise<string>);
const SAFE_DEBUG_METADATA_KEYS = new Set([
  'url', 'action', 'event', 'responseEvent', 'errorEvent', 'hasData',
  'code', 'attempt', 'maxRetries', 'timeout', 'errorCount', 'byteLength',
]);

const ReconnectingWebSocket = (
  (ReconnectingWebSocketModule as unknown as { default?: ReconnectingWebSocketConstructor }).default
  ?? ReconnectingWebSocketModule
) as ReconnectingWebSocketConstructor;

interface WsOptions {
  debug?: boolean;
  pingInterval?: number;
  connectionTimeout?: number;
  connectWaitTimeout?: number;
  maxRetries?: number;
  webSocket?: unknown;
}

export interface CallOption {
  responseEvent?: string;
  timeout?: number;
  retries?: number | false;
  buffer?: boolean;
  abortSignal?: AbortSignal;
}

export type WebSocketStatus = 'OPEN' | 'CONNECTING' | 'CLOSED';

type WebSocketCloseLikeEvent = ReconnectingWebSocketCloseEvent;
type WebSocketErrorLikeEvent = ReconnectingWebSocketErrorEvent &
  Partial<Pick<WebSocketCloseLikeEvent, 'code' | 'reason' | 'wasClean'>>;

type WebSocketLikeEvent = WebSocketCloseLikeEvent | WebSocketErrorLikeEvent;

export enum SocketEvent {
  BootError = 'Events.BootError',
  Response = 'response',
  Error = 'error',
  ClientId = 'App.Actions.GetClientId',
}

// Add specific error types for better error handling
export class ConnectionTimeoutError extends TransportError<'ConnectionTimeout'> {
  constructor(message: string = 'WebSocket connection timeout') {
    super(message, 'ConnectionTimeout');
  }
}

export class ConnectionFailedError extends TransportError<'ConnectionFailed'> {
  constructor(
    message: string,
    public readonly originalError?: unknown
  ) {
    super(message, 'ConnectionFailed', originalError);
  }
}

export class InvalidMessageError extends TransportError<'InvalidResponse'> {
  constructor(
    message: string,
    public readonly data?: unknown
  ) {
    super(message, 'InvalidResponse', data);
  }
}

// Add configuration validation
export class InvalidConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidConfigurationError';
  }
}

// Transport events that applications can listen to
export interface TransportEvents {
  'transport.boot_error': {
    error: RemoteError<'NotebookUnavailable'>;
    timestamp: number;
  };
  'transport.error': {
    type: string;
    error: unknown;
    rawMessage?: unknown;
    timestamp: number;
  };
  'transport.closed': {
    code?: number;
    reason?: string;
    timestamp: number;
  };
}

export class Transport {
  private readonly PING_INTERVAL: number;

  private clientId: string = '';

  private closed = false;

  private readonly rws: ReconnectingWebSocketInstance;

  private disposables: NamedDisposable = new NamedDisposable();

  private connectPromise: Promise<void> | null = null;

  private terminalError: Error | null = null;

  private readonly url: URL | null;

  private readonly CONNECT_WAIT_TIMEOUT: number;

  private pingIntervalStarted = false;

  private incomingMessageChain: Promise<void> = Promise.resolve();

  public constructor(
    url: TransportUrlProvider,
    private readonly eventEmitter: EventDispatcher,
    private readonly options: WsOptions = {}
  ) {
    // Validate configuration
    this.validateConfiguration(options);

    this.url = typeof url === 'string' ? new URL(url) : null;
    const urlProvider = typeof url === 'string'
      ? this.url.toString()
      : async () => new URL(await url()).toString();

    // Use configurable ping interval
    this.PING_INTERVAL = options.pingInterval ?? 30000;
    this.CONNECT_WAIT_TIMEOUT = options.connectWaitTimeout ?? 30000;

    this.rws = new ReconnectingWebSocket(urlProvider, [], {
      WebSocket: options.webSocket ?? globalThis.WebSocket ?? WebSocket,
      connectionTimeout: options.connectionTimeout,
      maxReconnectionDelay: 2000,
      minReconnectionDelay: 200,
      maxEnqueuedMessages: 0,
      maxRetries: options.maxRetries ?? 50,
      startClosed: true,
    });

    this.log('debug', 'Transport initialized', {
      url: this.url === null ? 'dynamic' : transportLogUrl(this.url),
      options,
    });
    this.registerWatchers();
  }

  /**
   * Validate configuration options
   */
  private validateConfiguration(options: WsOptions): void {
    if (options.pingInterval !== undefined && (options.pingInterval < 1000 || options.pingInterval > 300000)) {
      throw new InvalidConfigurationError('pingInterval must be between 1000ms and 300000ms');
    }

    if (options.connectionTimeout !== undefined && (options.connectionTimeout < 100 || options.connectionTimeout > 30000)) {
      throw new InvalidConfigurationError('connectionTimeout must be between 100ms and 30000ms');
    }

    if (options.connectWaitTimeout !== undefined && (options.connectWaitTimeout < 1000 || options.connectWaitTimeout > 300000)) {
      throw new InvalidConfigurationError('connectWaitTimeout must be between 1000ms and 300000ms');
    }

    if (options.maxRetries !== undefined && (options.maxRetries < 0 || options.maxRetries > 100)) {
      throw new InvalidConfigurationError('maxRetries must be between 0 and 100');
    }
  }

  /**
   * Internal logging utility for debugging
   */
  private log(level: 'debug' | 'info' | 'warn' | 'error', message: string, data?: unknown): void {
    if (this.options.debug) {
      const timestamp = new Date().toISOString();
      const metadata = safeDebugMetadata(data);
      const logData = metadata ? `\n${JSON.stringify(metadata, null, 2)}` : '';
      console[level](`[Transport ${timestamp}] ${message}${logData}`);
    }
  }

  /**
   * Explicitly connect to the websocket if not already connected
   * Used for lazy initialization
   *
   * This method ensures only one connection attempt happens at a time
   * by caching the connection promise.
   */
  #connect(): Promise<void> {
    if (this.terminalError) {
      return Promise.reject(this.terminalError);
    }

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

      let timeoutId: ReturnType<typeof setTimeout>;
      let errorCount = 0;

      const cleanup = () => {
        this.rws.removeEventListener('open', openHandler);
        this.rws.removeEventListener('error', errorHandler);
        this.rws.removeEventListener('close', closeHandler);
        clearTimeout(timeoutId);
      };

      const openHandler = () => {
        cleanup();

        // Clear the cached promise on success
        this.connectPromise = null;
        resolve();
        this.#startPeriodicPing();
      };

      const errorHandler = (error: WebSocketLikeEvent) => {
        errorCount += 1;
        this.log('warn', 'WebSocket emitted an error while connecting; waiting for reconnect/open', {
          errorCount,
          error: describeWebSocketEvent(error),
        });
      };

      const closeHandler = (event: WebSocketLikeEvent) => {
        const detail = describeWebSocketEvent(event);

        if (event.code === 1008 || event.code === 4000) {
          cleanup();
          this.connectPromise = null;
          reject(new ConnectionFailedError(`WebSocket connection failed: ${detail}`, event));
          return;
        }

        this.log('warn', 'WebSocket closed before opening; waiting for reconnect/open', {
          error: detail,
        });
      };

      this.rws.addEventListener('open', openHandler);
      this.rws.addEventListener('error', errorHandler);
      this.rws.addEventListener('close', closeHandler);

      // Open the connection if it's closed
      if (this.rws.readyState === 3) {
        this.rws.reconnect();
      }

      // Add timeout to prevent hanging forever
      timeoutId = setTimeout(() => {
        cleanup();

        // Clear the cached promise on timeout so retry is possible
        this.connectPromise = null;
        reject(new ConnectionTimeoutError(`WebSocket connection timeout after ${this.CONNECT_WAIT_TIMEOUT}ms`));
      }, this.CONNECT_WAIT_TIMEOUT);
    });

    return this.connectPromise;
  }

  /**
   * Ensure the websocket is open without requiring an application-level roundtrip.
   */
  public connect(): Promise<void> {
    if (this.terminalError) {
      return Promise.reject(this.terminalError);
    }

    return this.#connect();
  }

  #startPeriodicPing(): void {
    if (this.pingIntervalStarted || this.closed) {
      return;
    }

    this.pingIntervalStarted = true;
    this.disposables.add('pingInterval', () => {
      const interval = setInterval(async () => {
        try {
          this.log('debug', 'Sending periodic ping');

          await this.invoke('ping');

          this.log('debug', 'Ping successful');
        } catch (error) {
          this.log('error', 'Ping failed', {
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }, this.PING_INTERVAL);

      return {
        dispose: () => {
          clearInterval(interval);
          this.pingIntervalStarted = false;
        },
      };
    });
  }

  public id(): string {
    return this.clientId;
  }

  private async registerWatchers(): Promise<void> {
    const onMessage = (ev: MessageEvent) => {
      this.incomingMessageChain = this.incomingMessageChain
        .catch(() => undefined)
        .then(() => this.processIncomingMessage(ev))
        .catch((error) => {
          this.log('error', 'Failed to process queued WebSocket frame', {
            error: error instanceof Error ? error.message : String(error),
          });

          this.eventEmitter.emit('transport.error', {
            type: 'message_handle_error',
            error,
            rawMessage: ev.data,
            timestamp: Date.now(),
          });
        });
    };
    this.rws.addEventListener('message', onMessage);

    this.disposables.add('message', {
      dispose: () => {
        this.rws.removeEventListener('message', onMessage);
      },
    });
  }

  private async processIncomingMessage(ev: MessageEvent): Promise<void> {
    let buffer: ArrayBuffer;

    try {
      buffer = await this.toArrayBuffer(ev.data);
    } catch (error) {
      this.log('error', 'Unexpected WebSocket message type', {
        error: error instanceof Error ? error.message : String(error),
        messageType: typeof ev.data,
      });

      this.eventEmitter.emit('transport.error', {
        type: 'message_type_error',
        error,
        rawMessage: ev.data,
        timestamp: Date.now(),
      });
      return;
    }

    if (buffer.byteLength === 0) {
      this.log('warn', 'Ignoring empty WebSocket frame');
      return;
    }

    let decoded: unknown;
    try {
      decoded = decode(buffer);
    } catch (error) {
      this.log('error', 'Failed to decode WebSocket frame', {
        error: error instanceof Error ? error.message : String(error),
        byteLength: buffer.byteLength,
      });

      this.eventEmitter.emit('transport.error', {
        type: 'message_decode_error',
        error,
        rawMessage: buffer,
        timestamp: Date.now(),
      });
      return;
    }

    try {
      await this.handleRawMessage(decoded);
    } catch (error) {
      this.log('error', 'Failed to process WebSocket frame', {
        error: error instanceof Error ? error.message : String(error),
        byteLength: buffer.byteLength,
      });

      this.eventEmitter.emit('transport.error', {
        type: 'message_handle_error',
        error,
        rawMessage: buffer,
        timestamp: Date.now(),
      });
    }
  }

  private async toArrayBuffer(data: unknown): Promise<ArrayBuffer> {
    if (data instanceof Blob) {
      return data.arrayBuffer();
    }

    if (data instanceof ArrayBuffer) {
      return data;
    }

    if (ArrayBuffer.isView(data)) {
      const bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
      return bytes.slice().buffer;
    }

    throw new Error('Unexpected message type: ' + typeof data);
  }

  private async handleRawMessage(ev: unknown): Promise<void> {
    if (this.closed) {
      this.log('debug', 'Ignoring message received after transport was closed');
      return;
    }

    if (typeof ev !== 'object' || ev === null) {
      this.log('debug', 'Received invalid message format', { ev });
      return;
    }

    try {
      const { data, event, as } = ev as {
        data: unknown;
        event: string;
        as: string;
      };

      // Validate message structure
      if (!event || typeof event !== 'string') {
        throw new InvalidMessageError('Message missing event field', ev);
      }

      this.log('debug', 'Processing message', { event, hasData: !!data });

      if (event === SocketEvent.ClientId) {
        this.clientId = (data as { id: string }).id;
        this.log('info', 'Client ID received', { clientId: this.clientId });
        return;
      }

      if (event === SocketEvent.BootError) {
        const errorData = data as ({ message?: string } & object) | null | undefined;
        const error = new RemoteError(errorData?.message || 'Notebook is no longer available', {
          source: 'runtime',
          status: 503,
          code: 'NotebookUnavailable',
          details: errorData || {},
        });

        this.log('error', 'Boot error received', { data });
        this.terminate(error, 4000, error.message);
        return;
      }

      if (event === SocketEvent.Response) {
        // {"event":"response","data":{"responseEvent":"ping","data":"pong"}}
        const { responseEvent, data: responseData } = data as { responseEvent?: string; data?: unknown };

        if (!responseEvent) {
          throw new InvalidMessageError('Response message missing responseEvent', ev);
        }

        this.log('debug', 'Response message received', { responseEvent });
        await this.handleMessage(responseEvent, responseData);
        return;
      }

      if (event === SocketEvent.Error) {
        // {"event":"error","data":{"errorEvent":"pingo_error","data":{"code":404,"message":"Action pingo not found"}}}
        const { errorEvent, data: responseData } = data as { errorEvent?: string; data?: unknown };

        if (!errorEvent) {
          throw new InvalidMessageError('Error message missing errorEvent', ev);
        }

        this.log('debug', 'Error message received', {
          errorEvent,
          errorData: responseData,
        });
        await this.handleMessage(errorEvent, responseData);
        return;
      }

      await this.handleMessage(event, data, as);
    } catch (e) {
      if (e instanceof InvalidMessageError) {
        this.log('error', 'Invalid message format', {
          error: e.message,
          data: e.data,
        });
      } else {
        this.log('error', 'Failed to parse message', {
          ev,
          error: e instanceof Error ? e.message : String(e),
        });
      }

      // Don't throw - we want to continue processing other messages
      // But emit an error event for the application to handle
      this.eventEmitter.emit('transport.error', {
        type: 'message_parse_error',
        error: e,
        rawMessage: ev,
        timestamp: Date.now(),
      });
    }
  }

  private async handleMessage(event: string, data: unknown, as?: string): Promise<void> {
    if (event === SocketEvent.ClientId) {
      this.clientId = (data as { id: string }).id;
      this.eventEmitter.emit(event, this.clientId);

      return;
    }

    event && this.eventEmitter.emit(as || event, data);
  }

  public listen(event: string, listener: (data: unknown) => void, _context?: unknown) {
    return this.eventEmitter.listen(event, listener);
  }

  public onDidBootError(listener: (error: RemoteError<'NotebookUnavailable'>) => void): { dispose: () => void } {
    return this.eventEmitter.listen('transport.boot_error', (event: { error: RemoteError<'NotebookUnavailable'> }) => {
      listener(event.error);
    });
  }

  public removeListener(event: string, listener?: (data: unknown) => void): void {
    this.eventEmitter.removeListener(event, listener);
  }

  public listenOnce(event: string, listener: (data: unknown) => void, context?: unknown): { dispose: () => void } {
    return this.eventEmitter.once(event, listener, context);
  }

  public emit(event: string, ...data: unknown[]): void {
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

  public getTerminalError(): Error | null {
    return this.terminalError;
  }

  public get status(): string | undefined {
    return {
      0: 'CONNECTING',
      1: 'OPEN',
      2: 'CLOSING',
      3: 'CLOSED',
    }[this.rws.readyState];
  }

  public async call(action: string, data: object | string = {}, options: CallOption = {}): Promise<unknown> {
    if (this.terminalError) {
      throw this.terminalError;
    }

    const responseEvent = options.responseEvent || `${action}_${nanoid()}_response`;
    const errorEvent = `${responseEvent}_error`;

    let closeHandler: (ev: WebSocketLikeEvent) => void;
    let abortHandler: (() => void) | undefined;
    const removeListeners = () => {
      if (closeHandler) {
        this.rws.removeEventListener('close', closeHandler);
        this.rws.removeEventListener('error', closeHandler);
      }

      if (abortHandler) {
        options.abortSignal?.removeEventListener('abort', abortHandler);
        abortHandler = undefined;
      }

      this.eventEmitter.removeListener(responseEvent);
      this.eventEmitter.removeListener(errorEvent);
    };

    const handler = (resolve: (value: unknown) => void, reject: (reason?: unknown) => void): void => {
      if (this.terminalError) {
        reject(this.terminalError);
        return;
      }

      const abortError = new DOMException('Request aborted', 'AbortError');
      if (options.abortSignal?.aborted) {
        reject(abortError);
        return;
      }

      if (options.abortSignal) {
        abortHandler = () => {
          reject(abortError);
        };
        options.abortSignal.addEventListener('abort', abortHandler, { once: true });
      }

      if (!this.isConnected || this.isClosed) {
        reject(new ConnectionFailedError(`Connection is not open while sending ${action}. Current status: ${this.status}`));
        return;
      }

      this.listenOnce(responseEvent, (response) => {
        this.log('debug', 'Message response received', {
          action,
        });

        resolve(response);
      });

      this.listenOnce(errorEvent, (e) => {
        this.log('error', 'Message error received', { action, error: e });
        reject(remoteError('runtime', e));
      });

      closeHandler = (_ev: WebSocketLikeEvent) => {
        if (_ev.code === 1008 && (_ev.reason || '').includes('rate limit')) {
          reject(new RemoteError(_ev.reason || 'Rate limit exceeded', {
            source: 'runtime',
            status: 429,
            code: 'RateLimited',
            cause: _ev,
          }));
          return;
        }

        const detail = describeWebSocketEvent(_ev);
        reject(this.terminalError || new ConnectionFailedError(`Connection lost to the notebook during request: ${detail}`, _ev));
      };

      this.rws.addEventListener('close', closeHandler);
      this.rws.addEventListener('error', closeHandler);

      try {
        this.rws.send(this.pack({ action, data, errorEvent, responseEvent }));
        this.log('debug', 'Message sent', { action, data });
      } catch (error) {
        this.log('error', 'Failed to send message', { action, error });
        reject(new ConnectionFailedError(`Failed to send runtime action ${action}.`, error));
      }
    };

    const send = async () => {
      if (options.abortSignal?.aborted) {
        throw new DOMException('Request aborted', 'AbortError');
      }

      // Ensure connection is established before making calls
      await this.#connect();

      if (options.abortSignal?.aborted) {
        throw new DOMException('Request aborted', 'AbortError');
      }

      const promise = new Promise(handler).finally(removeListeners);
      if (!options.timeout) {
        return promise;
      }

      return timeout(promise, options.timeout).catch((error: unknown) => {
        if (error instanceof PromiseTimeoutError) {
          throw SendTimeoutError.fromPromiseTimeoutError(error);
        }

        throw error;
      }).finally(removeListeners);
    };

    const retries = options.retries === false ? 0 : options.retries ?? 0;

    return this.sendWithRetry(async () => await send(), retries);
  }

  public send(action: string, data: object | string = {}): boolean {
    if (this.terminalError) {
      throw this.terminalError;
    }

    if (!this.isConnected || this.isClosed) {
      this.log('debug', 'Connection not available, dropping one-way message', {
        action,
      });

      return false;
    }

    try {
      this.rws.send(this.pack({ action, data }));
      this.log('debug', 'One-way message sent', { action, data });

      return true;
    } catch (error) {
      this.log('error', 'Failed to send one-way message', { action, error });

      return false;
    }
  }

  private pack(data: string | ArrayBuffer | Blob | object): string | Blob | ArrayBuffer {
    return new Blob([encode(data) as BlobPart]);
  }

  private sendWithRetry(sender: () => Promise<unknown>, retries: number): Promise<unknown> {
    /**
     * Enhanced retry with exponential backoff and intelligent error handling
     */
    return retry(
      async (bail: (error: Error) => void, attempt: number) => {
        try {
          return await sender();
        } catch (e) {
          // Don't retry these errors
          if (
            e instanceof RemoteError ||
            e instanceof InvalidConfigurationError ||
            e instanceof InvalidMessageError ||
            e instanceof DOMException
          ) {
            this.log('debug', 'Non-retryable error, bailing', {
              error: e.message,
              attempt,
            });
            bail(e);
            return;
          }

          /**
           * If we can't send due to timeout, attempt to reconnect
           */
          if (e instanceof SendTimeoutError) {
            this.reconnect();
            this.log('warn', 'Send operation timed out, connection reset', {
              attempt,
              timeout: e.time,
            });
          }

          // Log retry attempt
          this.log('debug', 'Retrying send operation', {
            attempt,
            error: e instanceof Error ? e.message : String(e),
          });

          throw e;
        }
      },
      {
        retries,
        onRetry: (e: unknown, attempt: number) => {
          this.log('warn', 'Send operation retry', {
            attempt,
            maxRetries: retries,
            error: e instanceof Error ? e.message : String(e),
          });
        },
        // Use exponential backoff with jitter
        minTimeout: 1000,
        factor: 2,
        maxTimeout: 30000,
        randomize: true,
      }
    );
  }

  public invoke(action: string, data: object | string = {}, options: CallOption = {}): Promise<unknown> {
    if (!options.responseEvent) {
      options.responseEvent = `${action}_${nanoid()}`;
    }

    return this.call('invoke', { action, data }, options);
  }

  /**
   * Reconnect the websocket without disposing listeners.
   * Uses the underlying ReconnectingWebSocket's reconnect mechanism.
   * This preserves all event listeners and state.
   */
  public reconnect(): void {
    if (this.terminalError) {
      throw this.terminalError;
    }

    if (this.closed) {
      throw new Error('Cannot reconnect a closed transport. The transport has been permanently closed.');
    }

    this.log('info', 'Reconnecting transport');

    // Clear pending connection promise to allow fresh connection
    this.connectPromise = null;

    // Use ReconnectingWebSocket's built-in reconnect
    // This will close the current connection and open a new one
    // without disposing event listeners
    this.rws.reconnect();
  }

  public disconnect(): void {
    if (this.closed) {
      return;
    }

    this.close();
  }

  public terminate(error: Error, code: number = 4000, reason: string = error.message): void {
    this.terminalError = error;

    if (RemoteError.is(error, 'NotebookUnavailable')) {
      this.eventEmitter.emit('transport.boot_error', {
        error,
        timestamp: Date.now(),
      });
    }

    this.close(code, reason);
  }

  public close(code?: number, reason?: string): void {
    if (this.closed) {
      return;
    }

    this.log('info', 'Closing transport connection', { code, reason });

    // Clear any pending connection promise
    this.connectPromise = null;

    // Dispose all event disposables
    this.disposables.dispose();

    // Close WebSocket connection
    try {
      this.rws.close(code, reason);
    } catch (error) {
      this.log('error', 'Error closing WebSocket', {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    // Emit final close event
    this.eventEmitter.emit('transport.closed', {
      code,
      reason,
      timestamp: Date.now(),
    });

    this.eventEmitter.removeListener('*'); // Remove all event listeners
    this.closed = true;
    this.log('info', 'Transport connection closed successfully');
  }

  public onDidConnect(listener: () => void): { dispose: () => void } {
    this.rws.addEventListener('open', listener);
    const disposable = {
      dispose: () => {
        this.rws.removeEventListener('open', listener);
      },
    };
    this.disposables.add(`connect_${nanoid()}`, disposable);

    return disposable;
  }

  public onDidClose(listener: (e: WebSocketLikeEvent) => void): { dispose: () => void } {
    this.rws.addEventListener('close', listener);
    const disposable = {
      dispose: () => {
        this.rws.removeEventListener('close', listener);
      },
    };
    this.disposables.add(`close_${nanoid()}`, disposable);

    return disposable;
  }
}

function safeDebugMetadata(data: unknown): Record<string, string | number | boolean> | null {
  if (data === null || typeof data !== 'object') {
    return null;
  }

  // Message bodies and errors can contain tokens, source code, or process output.
  const metadata = Object.entries(data).filter(
    ([key, value]) => SAFE_DEBUG_METADATA_KEYS.has(key) && ['string', 'number', 'boolean'].includes(typeof value)
  );

  return metadata.length > 0 ? Object.fromEntries(metadata) : null;
}

function transportLogUrl(url: URL): string {
  const safeUrl = new URL(url);
  safeUrl.search = '';
  safeUrl.hash = '';

  return safeUrl.toString();
}
