import { nanoid } from 'nanoid';
import { encode, decode } from '@msgpack/msgpack';
import { ErrorEvent, RateLimitError } from '../types.js';
import retry from 'async-retry';
import ReconnectingWebSocket from 'reconnecting-websocket';
import type { CloseEvent, ErrorEvent as WsErrorEvent } from 'ws';
import { EventDispatcher } from '../events/index.js';
import { timeout } from '../utils/promise.js';
import WebSocket from 'isomorphic-ws';
import { NamedDisposable } from '../utils/disposable.js';

interface WsOptions {
  debug?: boolean;
  startClosed?: boolean;
  pingInterval?: number;
  connectionTimeout?: number;
  maxRetries?: number;
}

export interface CallOption {
  responseEvent?: string;
  timeout?: number;
  retries?: number | false;
  buffer?: boolean;
  abortSignal?: AbortSignal;
}

export type WebSocketStatus = 'OPEN' | 'CONNECTING' | 'CLOSED';

export enum SocketEvent {
  BootError = 'Events.BootError',
  Response = 'response',
  Error = 'error',
  ClientId = 'App.Actions.GetClientId',
}

// Add specific error types for better error handling
export class ConnectionTimeoutError extends Error {
  constructor(message: string = 'WebSocket connection timeout') {
    super(message);
    this.name = 'ConnectionTimeoutError';
  }
}

export class ConnectionFailedError extends Error {
  constructor(
    message: string,
    public readonly originalError?: Event
  ) {
    super(message);
    this.name = 'ConnectionFailedError';
  }
}

export class InvalidMessageError extends Error {
  constructor(
    message: string,
    public readonly data?: unknown
  ) {
    super(message);
    this.name = 'InvalidMessageError';
  }
}

// Add configuration validation
export class InvalidConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidConfigurationError';
  }
}

// Export types for better TypeScript integration
export interface ConnectionStats {
  connectTime: number;
  reconnectCount: number;
  lastPingTime: number;
  lastPongTime: number;
  avgResponseTime: number;
  totalMessages: number;
  totalErrors: number;
  connectionStartTime: number;
  connectionDuration: number;
  uptime: number;
  messagesPerSecond: string;
  errorRate: string;
  timeSinceLastPing: number;
  timeSinceLastPong: number;
}

export interface MessageQueueInfo {
  length: number;
  maxSize: number;
  oldestMessageAge: number;
}

export interface RateLimiterInfo {
  currentRequests: number;
  maxRequests: number;
  windowMs: number;
  isLimited: boolean;
}

export interface TransportConfig {
  pingInterval: number;
  queueTimeout: number;
  url: string;
}

export interface ConnectionMetrics {
  status: string | undefined;
  clientId: string;
  isConnected: boolean;
  isConnecting: boolean;
  connectionStats: ConnectionStats;
  messageQueue: MessageQueueInfo;
  rateLimiter: RateLimiterInfo;
  config: TransportConfig;
}

export type HealthStatus = 'healthy' | 'degraded' | 'unhealthy';

// Transport events that applications can listen to
export interface TransportEvents {
  'transport.error': {
    type: string;
    error: any;
    rawMessage?: unknown;
    timestamp: number;
  };
  'transport.closed': {
    code?: number;
    reason?: string;
    metrics: ConnectionMetrics;
    timestamp: number;
  };
}

export class Transport {
  private readonly PING_INTERVAL: number;

  private clientId: string = '';

  private closed = false;

  // @ts-expect-error
  private readonly rws: ReconnectingWebSocket;

  private disposables: NamedDisposable = new NamedDisposable();

  private connectPromise: Promise<void> | null = null;

  private readonly url: URL;

  // Connection health monitoring
  private connectionStats = {
    connectTime: 0,
    reconnectCount: 0,
    lastPingTime: 0,
    lastPongTime: 0,
    avgResponseTime: 0,
    totalMessages: 0,
    totalErrors: 0,
    connectionStartTime: 0,
  };

  // Message queue for disconnection handling
  private messageQueue: Array<{
    action: string;
    data: any;
    options: CallOption;
    resolve: (value: any) => void;
    reject: (reason: any) => void;
    timestamp: number;
  }> = [];

  private readonly MAX_QUEUE_SIZE = 100;
  private readonly QUEUE_TIMEOUT = 30000; // 30 seconds

  // Rate limiting
  private rateLimiter = {
    requests: [] as number[],
    maxRequests: 50,
    windowMs: 1000, // 1 second
  };

  public constructor(
    url: string,
    private readonly eventEmitter: EventDispatcher,
    private readonly options: WsOptions = {}
  ) {
    // Validate configuration
    this.validateConfiguration(options);

    this.url = new URL(url);
    this.url.searchParams.set('sdk_version', '0.0.1');

    // Use configurable ping interval
    this.PING_INTERVAL = options.pingInterval ?? 30000;

    // Initialize connection stats
    this.connectionStats.connectionStartTime = Date.now();

    // Always start closed by default (lazy initialization)
    const startClosed = options.startClosed !== false;

    // @ts-expect-error
    this.rws = new ReconnectingWebSocket(this.url.toString(), [], {
      WebSocket: globalThis.WebSocket ?? WebSocket,
      connectionTimeout: options.connectionTimeout ?? 1000,
      maxReconnectionDelay: 2000,
      minReconnectionDelay: 200,
      maxEnqueuedMessages: 0,
      maxRetries: options.maxRetries ?? 50,
      startClosed,
    });

    this.log('debug', 'Transport initialized', {
      url: this.url.toString(),
      options,
    });
    this.registerWatchers();
    this.setupConnectionHealthMonitoring();
    this.startPeriodicMaintenance();
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

    if (options.maxRetries !== undefined && (options.maxRetries < 0 || options.maxRetries > 100)) {
      throw new InvalidConfigurationError('maxRetries must be between 0 and 100');
    }
  }

  /**
   * Internal logging utility for debugging
   */
  private log(level: 'debug' | 'info' | 'warn' | 'error', message: string, data?: any): void {
    if (this.options.debug) {
      const timestamp = new Date().toISOString();
      const logData = data ? JSON.stringify(data, null, 2) : '';
      console[level](`[Transport ${timestamp}] ${message}${logData ? '\n' + logData : ''}`);
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
    this.disposables.add('pingInterval', () => {
      const interval = setInterval(async () => {
        try {
          this.connectionStats.lastPingTime = Date.now();
          this.log('debug', 'Sending periodic ping');

          const startTime = Date.now();
          await this.invoke('ping');

          this.connectionStats.lastPongTime = Date.now();
          const pingTime = this.connectionStats.lastPongTime - startTime;

          this.log('debug', `Ping successful`, { pingTime });
        } catch (error) {
          this.log('error', 'Ping failed', {
            error: error instanceof Error ? error.message : String(error),
          });

          // If ping fails consistently, the connection might be dead
          if (Date.now() - this.connectionStats.lastPongTime > this.PING_INTERVAL * 3) {
            this.log('warn', 'Connection appears dead, forcing reconnection');
            this.rws.reconnect();
          }
        }
      }, this.PING_INTERVAL);

      return {
        dispose: () => {
          clearInterval(interval);
        },
      };
    });
  }

  public id(): string {
    return this.clientId;
  }

  private async registerWatchers(): Promise<void> {
    const onMessage = (ev: MessageEvent) => {
      if (!(ev.data instanceof Blob)) {
        throw new Error('Unexpected message type: ' + typeof ev.data);
      }

      ev.data.arrayBuffer().then((buffer: ArrayBuffer) => {
        this.handleRawMessage(decode(buffer));
      });
    };
    this.rws.addEventListener('message', onMessage);

    this.disposables.add('message', {
      dispose: () => {
        this.rws.removeEventListener('message', onMessage);
      },
    });
  }

  private async handleRawMessage(ev: unknown): Promise<void> {
    if (typeof ev !== 'object' || ev === null) {
      this.log('debug', 'Received invalid message format', { ev });
      return;
    }

    try {
      const { data, event, as } = ev as {
        data: any;
        event: string;
        as: string;
      };

      // Validate message structure
      if (!event || typeof event !== 'string') {
        throw new InvalidMessageError('Message missing event field', ev);
      }

      this.log('debug', 'Processing message', { event, hasData: !!data });

      if (event === SocketEvent.ClientId) {
        this.clientId = data.id;
        this.log('info', 'Client ID received', { clientId: this.clientId });
        return;
      }

      if (event === SocketEvent.BootError) {
        this.log('error', 'Boot error received', { data });
        return;
      }

      if (event === SocketEvent.Response) {
        // {"event":"response","data":{"responseEvent":"ping","data":"pong"}}
        const { responseEvent, data: responseData } = data;

        if (!responseEvent) {
          throw new InvalidMessageError('Response message missing responseEvent', ev);
        }

        this.log('debug', 'Response message received', { responseEvent });
        await this.handleMessage(responseEvent, responseData);
        return;
      }

      if (event === SocketEvent.Error) {
        // {"event":"error","data":{"errorEvent":"pingo_error","data":{"code":404,"message":"Action pingo not found"}}}
        const { errorEvent, data: responseData } = data;

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
      this.connectionStats.totalErrors++;

      if (e instanceof InvalidMessageError) {
        this.log('error', 'Invalid message format', {
          error: e.message,
          data: e.data,
          totalErrors: this.connectionStats.totalErrors,
        });
      } else {
        this.log('error', 'Failed to parse message', {
          ev,
          error: e instanceof Error ? e.message : String(e),
          totalErrors: this.connectionStats.totalErrors,
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
    // Rate limiting check
    if (this.isRateLimited()) {
      throw new RateLimitError('Rate limit exceeded - too many requests');
    }

    // Clear old queued messages periodically
    this.clearOldQueuedMessages();

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
      const abortError = new DOMException('Request aborted', 'AbortError');
      if (options.abortSignal?.aborted) {
        reject(abortError);
      }

      if (options.abortSignal) {
        options.abortSignal.addEventListener('abort', () => {
          reject(abortError);
        });
      }

      // If not connected, queue the message
      if (!this.isConnected && !this.isClosed) {
        this.log('debug', 'Connection not available, queuing message', {
          action,
        });

        // Check queue size limit
        if (this.messageQueue.length >= this.MAX_QUEUE_SIZE) {
          const oldestMessage = this.messageQueue.shift();
          if (oldestMessage) {
            oldestMessage.reject(new Error('Message queue full, oldest message dropped'));
          }
        }

        this.messageQueue.push({
          action,
          data,
          options,
          resolve,
          reject,
          timestamp: Date.now(),
        });
        return;
      }

      const startTime = Date.now();

      this.listenOnce(responseEvent, (response) => {
        // Update response time stats
        const responseTime = Date.now() - startTime;
        this.connectionStats.avgResponseTime = (this.connectionStats.avgResponseTime + responseTime) / 2;
        this.connectionStats.totalMessages++;

        this.log('debug', 'Message response received', {
          action,
          responseTime,
          avgResponseTime: this.connectionStats.avgResponseTime,
        });

        resolve(response);
      });

      this.listenOnce(errorEvent, (e) => {
        this.connectionStats.totalErrors++;
        this.log('error', 'Message error received', { action, error: e });
        reject(new ErrorEvent(e.code, e.message, e));
      });

      closeHandler = (_ev: (CloseEvent | WsErrorEvent) & { reason?: string; code?: number }) => {
        if (_ev.code === 1008 && (_ev.reason || '').includes('rate limit')) {
          reject(new RateLimitError(_ev.reason || 'Rate limit exceeded', _ev));
          return;
        }
        reject(new Error(`Connection lost to the notebook during request: ${_ev.reason || 'Unknown reason'}`));
      };

      this.rws.addEventListener('close', closeHandler);
      this.rws.addEventListener('error', closeHandler);

      try {
        this.rws.send(this.pack({ action, data, errorEvent, responseEvent }));
        this.log('debug', 'Message sent', { action, data });
      } catch (error) {
        this.log('error', 'Failed to send message', { action, error });
        throw error;
      }
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
    return new Blob([encode(data) as BlobPart]);
  }

  private sendWithRetry(sender: () => Promise<any>, retries = 10): Promise<any> {
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
            e instanceof ErrorEvent ||
            e instanceof RateLimitError ||
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

          // Log retry attempt
          this.log('debug', 'Retrying send operation', {
            attempt,
            error: e instanceof Error ? e.message : String(e),
            nextDelay: this.getBackoffDelay(attempt - 1),
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

  public invoke(action: string, data: object | string = {}, options: CallOption = {}): Promise<any> {
    if (!options.responseEvent) {
      options.responseEvent = `${action}_${nanoid()}`;
    }

    return this.call('invoke', { action, data }, options);
  }

  public disconnect(): void {
    if (this.closed) {
      console.trace('Transport is already closed, cannot disconnect again');
      return;
    }

    this.close();
  }

  public close(code?: number, reason?: string): void {
    if (this.closed) {
      return;
    }

    this.log('info', 'Closing transport connection', { code, reason });

    // Clear any pending connection promise
    this.connectPromise = null;

    // Reject all queued messages
    const queuedCount = this.messageQueue.length;
    this.messageQueue.forEach((msg) => {
      console.log('Rejecting queued message due to connection close');
      msg.reject(new Error('Connection closed while message was queued'));
    });
    this.messageQueue = [];

    if (queuedCount > 0) {
      this.log('debug', `Rejected ${queuedCount} queued messages due to connection close`);
    }

    // Clear rate limiter
    this.rateLimiter.requests = [];

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
      metrics: this.getConnectionMetrics(),
      timestamp: Date.now(),
    });

    this.eventEmitter.removeListener('*'); // Remove all event listeners
    this.closed = true;
    this.log('info', 'Transport connection closed successfully');
  }

  public onDidConnect(listener: () => void): void {
    this.rws.addEventListener('open', listener);
    this.disposables.add('connect', {
      dispose: () => {
        this.rws.removeEventListener('open', listener);
      },
    });
  }

  public onDidClose(listener: (e: CloseEvent | WsErrorEvent) => void): void {
    this.rws.addEventListener('close', listener);
    this.disposables.add('close', {
      dispose: () => {
        this.rws.removeEventListener('close', listener);
      },
    });
  }

  /**
   * Setup connection health monitoring
   */
  private setupConnectionHealthMonitoring(): void {
    this.rws.addEventListener('open', () => {
      this.connectionStats.connectTime = Date.now();
      this.connectionStats.reconnectCount++;
      this.log('info', 'Connection established', {
        reconnectCount: this.connectionStats.reconnectCount,
        timeSinceStart: Date.now() - this.connectionStats.connectionStartTime,
      });
      this.processMessageQueue();
    });

    this.rws.addEventListener('close', (event: CloseEvent) => {
      this.log('warn', 'Connection closed', {
        code: event.code,
        reason: event.reason,
        wasClean: event.wasClean,
      });
      this.handleConnectionClose(event.code);
    });

    this.rws.addEventListener('error', (event: ErrorEvent) => {
      this.connectionStats.totalErrors++;
      this.log('error', 'Connection error', {
        error: event,
        totalErrors: this.connectionStats.totalErrors,
      });
    });
  }

  /**
   * Handle different WebSocket close codes appropriately
   */
  private handleConnectionClose(code: number): 'reconnect' | 'stop' | 'retry' {
    switch (code) {
      case 1000: // Normal closure
        this.log('info', 'Normal connection closure');
        return 'stop';
      case 1001: // Going away
        this.log('info', 'Connection going away, will reconnect');
        return 'reconnect';
      case 1006: // Abnormal closure
        this.log('warn', 'Abnormal connection closure, will retry');
        return 'retry';
      case 1008: // Policy violation (rate limit)
        this.log('error', 'Connection closed due to policy violation');
        this.clearOldQueuedMessages();
        return 'stop';
      default:
        this.log('warn', `Unknown close code: ${code}, will reconnect`);
        return 'reconnect';
    }
  }

  /**
   * Process queued messages when connection is restored
   */
  private processMessageQueue(): void {
    if (this.messageQueue.length === 0) {
      return;
    }

    this.log('debug', `Processing ${this.messageQueue.length} queued messages`);

    const queue = [...this.messageQueue];
    this.messageQueue = [];

    for (const queuedMessage of queue) {
      // Check if message hasn't timed out
      if (Date.now() - queuedMessage.timestamp > this.QUEUE_TIMEOUT) {
        queuedMessage.reject(new Error('Queued message timed out'));
        continue;
      }

      // Retry the message
      this.call(queuedMessage.action, queuedMessage.data, queuedMessage.options)
        .then(queuedMessage.resolve)
        .catch(queuedMessage.reject);
    }
  }

  /**
   * Clear old queued messages to prevent memory leaks
   */
  private clearOldQueuedMessages(): void {
    const now = Date.now();
    const originalLength = this.messageQueue.length;

    this.messageQueue = this.messageQueue.filter((msg) => {
      const isExpired = now - msg.timestamp > this.QUEUE_TIMEOUT;
      if (isExpired) {
        msg.reject(new Error('Queued message expired'));
      }
      return !isExpired;
    });

    if (originalLength !== this.messageQueue.length) {
      this.log('debug', `Cleared ${originalLength - this.messageQueue.length} expired messages`);
    }
  }

  /**
   * Rate limiting check
   */
  private isRateLimited(): boolean {
    const now = Date.now();

    // Remove old requests outside the window
    this.rateLimiter.requests = this.rateLimiter.requests.filter((timestamp) => now - timestamp < this.rateLimiter.windowMs);

    // Check if we've exceeded the limit
    if (this.rateLimiter.requests.length >= this.rateLimiter.maxRequests) {
      return true;
    }

    // Add current request
    this.rateLimiter.requests.push(now);
    return false;
  }

  /**
   * Calculate exponential backoff delay
   */
  private getBackoffDelay(retryCount: number): number {
    const baseDelay = 1000; // 1 second
    const maxDelay = 30000; // 30 seconds
    const delay = Math.min(baseDelay * Math.pow(2, retryCount), maxDelay);

    // Add jitter to prevent thundering herd
    return delay + Math.random() * 1000;
  }

  /**
   * Get comprehensive connection metrics
   */
  public getConnectionMetrics() {
    const now = Date.now();
    const connectionDuration = this.connectionStats.connectTime > 0 ? now - this.connectionStats.connectTime : 0;

    return {
      status: this.status,
      clientId: this.clientId,
      isConnected: this.isConnected,
      isConnecting: this.isConnecting,
      connectionStats: {
        ...this.connectionStats,
        connectionDuration,
        uptime: now - this.connectionStats.connectionStartTime,
        messagesPerSecond:
          connectionDuration > 0 ? (this.connectionStats.totalMessages / (connectionDuration / 1000)).toFixed(2) : '0',
        errorRate:
          this.connectionStats.totalMessages > 0
            ? ((this.connectionStats.totalErrors / this.connectionStats.totalMessages) * 100).toFixed(2) + '%'
            : '0%',
        timeSinceLastPing: this.connectionStats.lastPingTime > 0 ? now - this.connectionStats.lastPingTime : 0,
        timeSinceLastPong: this.connectionStats.lastPongTime > 0 ? now - this.connectionStats.lastPongTime : 0,
      },
      messageQueue: {
        length: this.messageQueue.length,
        maxSize: this.MAX_QUEUE_SIZE,
        oldestMessageAge: this.messageQueue.length > 0 ? now - Math.min(...this.messageQueue.map((m) => m.timestamp)) : 0,
      },
      rateLimiter: {
        currentRequests: this.rateLimiter.requests.length,
        maxRequests: this.rateLimiter.maxRequests,
        windowMs: this.rateLimiter.windowMs,
        isLimited: this.isRateLimited(),
      },
      config: {
        pingInterval: this.PING_INTERVAL,
        queueTimeout: this.QUEUE_TIMEOUT,
        url: this.url.toString(),
      },
    };
  }

  /**
   * Get connection health status
   */
  public getHealthStatus(): 'healthy' | 'degraded' | 'unhealthy' {
    const metrics = this.getConnectionMetrics();
    const stats = metrics.connectionStats;

    // Unhealthy conditions
    if (!this.isConnected || stats.timeSinceLastPong > this.PING_INTERVAL * 2 || Number.parseFloat(stats.errorRate) > 50) {
      return 'unhealthy';
    }

    // Degraded conditions
    if (
      stats.avgResponseTime > 5000 ||
      Number.parseFloat(stats.errorRate) > 10 ||
      stats.timeSinceLastPong > this.PING_INTERVAL * 1.5
    ) {
      return 'degraded';
    }

    return 'healthy';
  }

  /**
   * Reset connection statistics
   */
  public resetStats(): void {
    this.connectionStats = {
      connectTime: Date.now(),
      reconnectCount: 0,
      lastPingTime: 0,
      lastPongTime: 0,
      avgResponseTime: 0,
      totalMessages: 0,
      totalErrors: 0,
      connectionStartTime: Date.now(),
    };

    this.log('debug', 'Connection statistics reset');
  }

  /**
   * Run connection diagnostics
   */
  public async runDiagnostics(): Promise<{
    status: HealthStatus;
    metrics: ConnectionMetrics;
    issues: string[];
    recommendations: string[];
  }> {
    const metrics = this.getConnectionMetrics();
    const status = this.getHealthStatus();
    const issues: string[] = [];
    const recommendations: string[] = [];

    // Check for issues
    if (!this.isConnected) {
      issues.push('Connection is not established');
      recommendations.push('Check network connectivity and server availability');
    }

    if (metrics.connectionStats.timeSinceLastPong > this.PING_INTERVAL * 2) {
      issues.push('No pong received recently - connection may be stale');
      recommendations.push('Consider forcing a reconnection');
    }

    if (Number.parseFloat(metrics.connectionStats.errorRate) > 10) {
      issues.push(`High error rate: ${metrics.connectionStats.errorRate}`);
      recommendations.push('Check server logs and network stability');
    }

    if (metrics.messageQueue.length > this.MAX_QUEUE_SIZE * 0.8) {
      issues.push('Message queue is nearly full');
      recommendations.push('Check connection stability and consider reducing message frequency');
    }

    if (metrics.connectionStats.avgResponseTime > 5000) {
      issues.push('High average response time');
      recommendations.push('Check network latency and server performance');
    }

    if (metrics.rateLimiter.isLimited) {
      issues.push('Rate limiting is active');
      recommendations.push('Reduce request frequency or increase rate limit');
    }

    this.log('info', 'Connection diagnostics completed', {
      status,
      issueCount: issues.length,
      recommendationCount: recommendations.length,
    });

    return {
      status,
      metrics,
      issues,
      recommendations,
    };
  }

  /**
   * Periodic maintenance - clean up old data, run health checks
   */
  private startPeriodicMaintenance(): void {
    this.disposables.add('maintenance', () => {
      // Run maintenance every 5 minutes
      const maintenanceInterval = setInterval(
        () => {
          this.clearOldQueuedMessages();

          // Clean up old rate limiter entries (should already be done, but double-check)
          const now = Date.now();
          this.rateLimiter.requests = this.rateLimiter.requests.filter(
            (timestamp) => now - timestamp < this.rateLimiter.windowMs
          );

          // Log health status if debug is enabled
          if (this.options.debug) {
            const health = this.getHealthStatus();
            const metrics = this.getConnectionMetrics();
            this.log('debug', 'Periodic health check', {
              health,
              messageCount: metrics.connectionStats.totalMessages,
              errorCount: metrics.connectionStats.totalErrors,
              queueLength: metrics.messageQueue.length,
            });
          }
        },
        5 * 60 * 1000
      ); // 5 minutes

      return {
        dispose: () => {
          clearInterval(maintenanceInterval);
        },
      };
    });
  }
}
