import EventManager, { EventDispatcher } from '../events/index.js';
import { Disposable } from '../types.js';
import { timeout } from '../utils/promise.js';
import retry from 'async-retry';
import {
  BeaconMessage,
  BeaconActions,
  BeaconEvents,
  BeaconOptions,
  DebugInfo,
  ConsoleEvent,
  BeaconErrorEvent,
  DebugRequest,
  DebugResult,
  FetchRequest,
  FetchResult,
} from './types.js';
import { Navigator } from './navigator.js';

export * from './types.js';
export { Navigator } from './navigator.js';

/**
 * Browser environment check
 */
function ensureBrowserEnvironment(): void {
  if (typeof window === 'undefined') {
    throw new Error('Beacon SDK can only be used in a browser environment');
  }
}

/**
 * BeaconError for beacon-specific errors
 */
export class BeaconError extends Error {
  constructor(
    message: string,
    public code?: string
  ) {
    super(message);
    this.name = 'BeaconError';
  }
}

/**
 * BeaconTimeoutError for timeout-specific errors
 */
export class BeaconTimeoutError extends BeaconError {
  constructor(operation: string, timeoutMs: number) {
    super(`Beacon operation '${operation}' timed out after ${timeoutMs}ms`);
    this.code = 'TIMEOUT';
  }
}

/**
 * BeaconConnectionError for connection-specific errors
 */
export class BeaconConnectionError extends BeaconError {
  constructor(message: string) {
    super(`Beacon connection error: ${message}`);
    this.code = 'CONNECTION_ERROR';
  }
}

/**
 * Beacon SDK for communicating with beacon instances in iframes
 */
export class Beacon implements BeaconActions {
  public readonly iframe: HTMLIFrameElement;
  private options: Required<BeaconOptions>;
  private messageHandlers: Map<string, ((payload: any) => void)[]> = new Map();
  private eventEmitter: EventDispatcher;
  private isBeaconReady = false;
  private readyPromise: Promise<void> | null = null;
  private isStarted = false;
  private disposables: Disposable[] = [];
  private iframeLoadHandlers: (() => void)[] = [];

  public readonly navigator: Navigator;

  constructor(iframe: HTMLIFrameElement, options: BeaconOptions = {}) {
    ensureBrowserEnvironment();

    this.iframe = iframe;

    // Set up default retry options
    const defaultRetryOptions = {
      retries: 3,
      minTimeout: 1000,
      maxTimeout: 5000,
      factor: 2,
      randomize: true,
    };

    this.options = {
      timeout: 10000,
      targetOrigin: '*',
      debug: false,
      retry: {
        ...defaultRetryOptions,
        ...options.retry,
      },
      ...options,
    };

    this.eventEmitter = EventManager.make();
    this.setupMessageListener();

    // Initialize navigator
    this.navigator = new Navigator(
      this.eventEmitter.listen.bind(this.eventEmitter),
      this.eventEmitter.once.bind(this.eventEmitter),
      this
    );

    // Note: Beacon ready process is not started automatically
    // Call start() method to begin beacon initialization
  }

  /**
   * Setup global message listener for iframe communication
   */
  private setupMessageListener(): void {
    const messageHandler = (event: MessageEvent) => {
      try {
        // Verify message source
        if (event.source !== this.iframe.contentWindow) {
          return;
        }

        const message: BeaconMessage = event.data;

        if (!message || typeof message !== 'object' || !message.type) {
          return;
        }

        // Only handle beacon messages
        if (!message.type.startsWith('beacon:')) {
          return;
        }

        this.handleBeaconMessage(message);
      } catch (error) {
        if (this.options.debug) {
          console.error('[Beacon SDK] Message parsing error:', error);
        }
      }
    };

    window.addEventListener('message', messageHandler);

    // Add to disposables for cleanup
    this.disposables.push({
      dispose: () => window.removeEventListener('message', messageHandler),
    });
  }

  /**
   * Handle incoming beacon messages
   */
  private handleBeaconMessage(message: BeaconMessage): void {
    if (this.options.debug) {
      console.log('[Beacon SDK] Received message:', message.type, message.payload);
    }

    // Handle ready message specially
    if (message.type === 'beacon:ready') {
      this.isBeaconReady = true;
      this.emit('ready', message.payload);
    }

    // Emit the event (remove 'beacon:' prefix for cleaner API)
    const eventType = message.type.replace('beacon:', '');
    this.emit(eventType, message.payload);

    // Call registered message handlers
    const handlers = this.messageHandlers.get(message.type);
    if (handlers) {
      handlers.forEach((handler) => {
        try {
          handler(message.payload);
        } catch (error) {
          if (this.options.debug) {
            console.error('[Beacon SDK] Message handler error:', error);
          }
        }
      });
    }
  }

  /**
   * Wait for iframe to be loaded and content window to be available
   */
  private waitForIframeReady(): Promise<void> {
    return new Promise((resolve) => {
      // Check if iframe is already loaded and contentWindow is available
      if (
        this.iframe.contentWindow &&
        (this.iframe.contentDocument?.readyState === 'complete' || this.iframe.contentDocument?.readyState === 'interactive')
      ) {
        resolve();
        return;
      }

      // Listen for iframe load event
      const handleLoad = () => {
        this.iframe.removeEventListener('load', handleLoad);
        this.iframeLoadHandlers = this.iframeLoadHandlers.filter((h) => h !== handleLoad);
        // Add small delay to ensure contentWindow is fully available
        setTimeout(resolve, 100);
      };

      this.iframe.addEventListener('load', handleLoad);
      this.iframeLoadHandlers.push(handleLoad);

      // Fallback: if iframe is already loading but hasn't fired load event
      if (this.iframe.contentWindow) {
        const checkReady = () => {
          if (this.iframe.contentDocument?.readyState === 'complete') {
            this.iframe.removeEventListener('load', handleLoad);
            this.iframeLoadHandlers = this.iframeLoadHandlers.filter((h) => h !== handleLoad);
            resolve();
          } else {
            setTimeout(checkReady, 100);
          }
        };
        checkReady();
      }
    });
  }

  /**
   * Wait for beacon to be ready with retry logic
   */
  private waitForBeaconReady(): Promise<void> {
    return retry(
      async () => {
        return new Promise<void>(async (resolve, reject) => {
          if (this.isBeaconReady) {
            resolve();
            return;
          }

          const timeoutMs = this.options.timeout;
          const timeoutId = setTimeout(() => {
            unsubscribe.dispose();
            // Reject timeout to trigger retry
            reject(new BeaconTimeoutError('beacon ready', timeoutMs));
          }, timeoutMs);

          const unsubscribe = this.on('ready', () => {
            clearTimeout(timeoutId);
            unsubscribe.dispose();
            resolve();
          });

          try {
            // Wait for iframe to be ready before sending discovery message
            await this.waitForIframeReady();
            await this.sendDiscoveryMessage();
          } catch (error) {
            clearTimeout(timeoutId);
            unsubscribe.dispose();
            reject(error);
          }
        });
      },
      {
        retries: this.options.retry?.retries || 3,
        minTimeout: this.options.retry?.minTimeout || 1000,
        maxTimeout: this.options.retry?.maxTimeout || 5000,
        factor: this.options.retry?.factor || 2,
        randomize: this.options.retry?.randomize || true,
        onRetry: (error, attempt) => {
          if (this.options.debug) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            console.warn(`[Beacon SDK] Beacon ready retry attempt ${attempt}:`, errorMessage);
          }
          // Reset ready state for retry
          this.isBeaconReady = false;
        },
      }
    );
  }

  /**
   * Send discovery message with configurable retry logic
   */
  private async sendDiscoveryMessage(): Promise<void> {
    return retry(
      async () => {
        if (!this.iframe.contentWindow) {
          throw new BeaconConnectionError('Iframe contentWindow not available');
        }

        this.sendMessage('discover', {});
      },
      {
        retries: this.options.retry?.retries || 3,
        minTimeout: this.options.retry?.minTimeout || 1000,
        maxTimeout: this.options.retry?.maxTimeout || 5000,
        factor: this.options.retry?.factor || 2,
        randomize: this.options.retry?.randomize || true,
        onRetry: (error, attempt) => {
          if (this.options.debug) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            console.warn(`[Beacon SDK] Discovery retry attempt ${attempt}:`, errorMessage);
          }
        },
      }
    );
  }

  /**
   * Send a message to the beacon
   */
  private sendMessage<T = any>(type: string, payload: T = {} as T): void {
    if (!this.iframe.contentWindow) {
      throw new BeaconConnectionError('Iframe contentWindow is not available');
    }

    // Additional safety check for iframe readiness
    if (this.iframe.contentDocument && this.iframe.contentDocument.readyState === 'loading') {
      throw new BeaconConnectionError('Iframe is still loading, contentWindow not ready');
    }

    const message: BeaconMessage<T> = {
      type: `beacon:${type}`,
      payload,
      timestamp: Date.now(),
      source: 'parent',
      id: this.generateId(),
    };

    try {
      // Use structuredClone to ensure message can be posted safely
      let clonedMessage: BeaconMessage<T>;
      try {
        clonedMessage = structuredClone(message);
      } catch (cloneError) {
        if (this.options.debug) {
          console.warn('[Beacon SDK] Failed to clone message, using JSON fallback:', cloneError);
        }
        clonedMessage = JSON.parse(JSON.stringify(message));
      }

      this.iframe.contentWindow.postMessage(clonedMessage, this.options.targetOrigin);

      if (this.options.debug) {
        console.log('[Beacon SDK] Sent message:', message.type, message.payload);
      }
    } catch (error) {
      throw new BeaconConnectionError(`Failed to send message: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Send a message and wait for a specific response with retry logic
   */
  private async sendAndWaitFor<TPayload = any, TResponse = any>(
    sendType: string,
    responseType: string,
    payload: TPayload = {} as TPayload,
    timeoutMs?: number
  ): Promise<TResponse> {
    await this.ready();

    return retry(
      async (bail) => {
        return new Promise<TResponse>((resolve, reject) => {
          const actualTimeout = timeoutMs || this.options.timeout;
          const timeoutId = setTimeout(() => {
            unsubscribe.dispose();
            // Reject timeout to trigger retry (will only bail on final attempt)
            const error = new BeaconTimeoutError(sendType, actualTimeout);
            reject(error);
          }, actualTimeout);

          const unsubscribe = this.eventEmitter.listen(responseType, (data: any) => {
            clearTimeout(timeoutId);
            unsubscribe.dispose();
            resolve(data as TResponse);
          });

          try {
            this.sendMessage(sendType, payload);
          } catch (error) {
            clearTimeout(timeoutId);
            unsubscribe.dispose();
            // Retry on connection errors, bail on other types of errors
            if (error instanceof BeaconConnectionError) {
              reject(error); // Will trigger retry
            } else {
              bail(error); // Don't retry for other types of errors
            }
          }
        });
      },
      {
        retries: this.options.retry?.retries || 3,
        minTimeout: this.options.retry?.minTimeout || 1000,
        maxTimeout: this.options.retry?.maxTimeout || 5000,
        factor: this.options.retry?.factor || 2,
        randomize: this.options.retry?.randomize || true,
        onRetry: (error, attempt) => {
          if (this.options.debug) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            console.warn(`[Beacon SDK] Retry attempt ${attempt} for ${sendType}:`, errorMessage);
          }
        },
      }
    );
  }

  /**
   * Generate a unique ID for messages
   */
  private generateId(): string {
    return `sdk_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }

  /**
   * Event emitter methods (both private and public for navigator access)
   */
  public emit(event: string, payload: any): void {
    this.eventEmitter.emit(event, payload);
  }

  /**
   * Start the beacon initialization process
   */
  public start(): Promise<void> {
    if (this.isStarted) {
      return this.readyPromise || Promise.resolve();
    }

    this.isStarted = true;
    this.readyPromise = this.waitForBeaconReady();
    return this.readyPromise;
  }

  /**
   * Wait for the beacon to be ready
   */
  public async ready(): Promise<void> {
    if (!this.isStarted) {
      throw new BeaconError('Beacon has not been started. Call start() first.');
    }

    if (!this.readyPromise) {
      throw new BeaconError('Beacon ready promise is not available');
    }

    return timeout(this.readyPromise, this.options.timeout);
  }

  /**
   * Check if beacon is ready
   */
  public get isReady(): boolean {
    return this.isBeaconReady;
  }

  /**
   * Listen for beacon events
   */
  public on<K extends keyof BeaconEvents>(event: K, handler: (payload: BeaconEvents[K]) => void): Disposable {
    return this.eventEmitter.listen(event as string, handler);
  }

  /**
   * Listen for beacon events (one-time)
   */
  public once<K extends keyof BeaconEvents>(event: K, handler: (payload: BeaconEvents[K]) => void): void {
    this.eventEmitter.once(event as string, handler);
  }

  /**
   * Ping the beacon to check if it's responsive
   */
  public async ping(): Promise<boolean> {
    try {
      await this.sendAndWaitFor('ping', 'pong', { timestamp: Date.now() });
      return true;
    } catch (error) {
      if (this.options.debug) {
        console.warn('[Beacon SDK] Ping failed:', error);
      }
      return false;
    }
  }

  /**
   * Get debug information from the beacon
   */
  public async getDebugInfo(): Promise<DebugInfo> {
    return this.sendAndWaitFor<{}, DebugInfo>('getDebugInfo', 'debugInfo');
  }

  /**
   * Get console events from the beacon
   */
  public async getConsoleEvents(): Promise<ConsoleEvent[]> {
    return this.sendAndWaitFor<{}, ConsoleEvent[]>('getConsoleEvents', 'consoleEvents');
  }

  /**
   * Get error events from the beacon
   */
  public async getErrorEvents(): Promise<BeaconErrorEvent[]> {
    return this.sendAndWaitFor<{}, BeaconErrorEvent[]>('getErrorEvents', 'errorEvents');
  }

  /**
   * Clear console events in the beacon
   */
  public async clearConsole(): Promise<void> {
    await this.ready();
    this.sendMessage('clearConsole');
  }

  /**
   * Clear error events in the beacon
   */
  public async clearErrors(): Promise<void> {
    await this.ready();
    this.sendMessage('clearErrors');
  }

  /**
   * Execute code in the beacon context
   */
  public async executeCode(code: string): Promise<{ success: boolean; result?: any; error?: string }> {
    return this.sendAndWaitFor('executeCode', 'codeExecutionResult', { code });
  }

  /**
   * Inspect an element in the beacon context
   */
  public async inspectElement(selector: string): Promise<{ success: boolean; element?: any; error?: string }> {
    return this.sendAndWaitFor('inspectElement', 'elementInspectionResult', { selector });
  }

  /**
   * Fetch a URL in the beacon context
   */
  public async fetch<T extends unknown>(request: FetchRequest): Promise<FetchResult<T>> {
    return this.sendAndWaitFor('fetch', 'fetchResult', request);
  }

  /**
   * Debug a page (navigate and capture debug information). It loads
   * the page fresh in the IFRAME so that we can capture the latest state.
   */
  public async debug(request: DebugRequest, waitSeconds?: number): Promise<DebugResult> {
    // First, navigate the iframe if the path is different from current URL
    const targetUrl = new URL(request.path, this.iframe.src || window.location.origin).href;

    if (this.iframe.src !== targetUrl) {
      // Navigate the iframe from parent side
      this.navigator.visit(targetUrl);

      // Wait for beacon to be ready after navigation
      await this.ready();
    }

    /**
     * Let's wait for 2 seconds for page to finish rendering.
     * Errors, that might occur during this time will be captured.
     */
    waitSeconds && (await this.wait(waitSeconds));

    // Now request debug capture from the beacon (without navigation)
    const timeoutMs = (request.options?.timeout || 30000) + 5000; // Add 5s buffer
    return this.sendAndWaitFor('debug', 'debugResult', request, timeoutMs);
  }

  private async wait(forSeconds: number) {
    return new Promise((resolve) => setTimeout(resolve, forSeconds * 1000));
  }

  /**
   * Navigate the iframe to a new URL
   */
  public navigate(url: string): void {
    if (!this.iframe) {
      throw new BeaconConnectionError('Iframe not available');
    }

    try {
      const targetUrl = new URL(url, this.iframe.src || window.location.origin);
      this.iframe.src = targetUrl.href;
      this.isBeaconReady = false; // Reset ready state since we're navigating

      // Only create new ready promise if beacon was already started
      if (this.isStarted) {
        this.readyPromise = this.waitForBeaconReady();
      }
    } catch (error) {
      throw new BeaconConnectionError(`Invalid URL: ${url}`);
    }
  }

  /**
   * Get current iframe URL
   */
  public get url(): string {
    return this.iframe.src;
  }

  /**
   * Get the iframe element
   */
  public get element(): HTMLIFrameElement {
    return this.iframe;
  }

  /**
   * Dispose of all resources
   */
  public dispose(): void {
    // Clean up iframe event listeners
    if (this.iframe) {
      this.iframeLoadHandlers.forEach((handler) => {
        this.iframe.removeEventListener('load', handler);
      });
      this.iframeLoadHandlers = [];
    }

    this.disposables.forEach((disposable) => disposable.dispose());
    this.disposables = [];
    this.messageHandlers.clear();
    this.isBeaconReady = false;
    this.isStarted = false;
    this.readyPromise = null;
  }
}

/**
 * Factory function to create a beacon instance for an iframe
 */
export function createBeacon(iframe: HTMLIFrameElement, options?: BeaconOptions): Beacon {
  return new Beacon(iframe, options);
}

/**
 * Check if the current environment supports the Beacon SDK
 */
export function isBeaconSupported(): boolean {
  try {
    ensureBrowserEnvironment();
    return true;
  } catch {
    return false;
  }
}
