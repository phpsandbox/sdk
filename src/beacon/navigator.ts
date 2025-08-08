import type { Disposable } from '../types.js';

export interface NavigatorActions {
  goBack(): Promise<void>;
  goForward(): Promise<void>;
  reload(): Promise<void>;
  pushState(state: any, title: string, url: string): Promise<void>;
  replaceState(state: any, title: string, url: string): Promise<void>;
  getHistoryLength(): Promise<number>;
  getHistoryState(): Promise<any>;
  getHistoryInfo(): Promise<HistoryInfoResponse>;
  canGoBack(): Promise<boolean>;
  canGoForward(): Promise<boolean>;
}

export interface NavigatorEvents {
  historyChange: {
    url: string;
    state: any;
    direction: 'back' | 'forward' | 'push' | 'replace' | 'reload';
    timestamp: number;
  };
}

export interface HistoryNavigationRequest {
  action: 'back' | 'forward' | 'reload';
}

export interface HistoryStateRequest {
  state: any;
  title: string;
  url: string;
  action: 'push' | 'replace';
}

export interface HistoryInfoResponse {
  length: number;
  state: any;
  url: string;
  canGoBack: boolean;
  canGoForward: boolean;
}

export interface Navigator extends NavigatorActions {
  on<K extends keyof NavigatorEvents>(
    event: K,
    handler: (payload: NavigatorEvents[K]) => void
  ): Disposable;

  once<K extends keyof NavigatorEvents>(
    event: K,
    handler: (payload: NavigatorEvents[K]) => void
  ): void;
}

/**
 * SDK Navigator implementation
 */
export class Navigator implements NavigatorActions {
  constructor(
    private sendAndWaitFor: <T = any, R = any>(
      sendType: string,
      waitType: string,
      payload?: T,
      timeout?: number
    ) => Promise<R>,
    private onEvent: <K extends keyof NavigatorEvents>(
      event: K,
      handler: (payload: NavigatorEvents[K]) => void
    ) => Disposable,
    private onceEvent: <K extends keyof NavigatorEvents>(
      event: K,
      handler: (payload: NavigatorEvents[K]) => void
    ) => void
  ) {}

  /**
   * Navigate back in iframe history
   */
  async goBack(): Promise<void> {
    await this.sendAndWaitFor('historyBack', 'historyNavigated', { action: 'back' });
  }

  /**
   * Navigate forward in iframe history
   */
  async goForward(): Promise<void> {
    await this.sendAndWaitFor('historyForward', 'historyNavigated', { action: 'forward' });
  }

  /**
   * Reload the current page in iframe
   */
  async reload(): Promise<void> {
    await this.sendAndWaitFor('historyReload', 'historyNavigated', { action: 'reload' });
  }

  /**
   * Push a new state to iframe history
   */
  async pushState(state: any, title: string, url: string): Promise<void> {
    await this.sendAndWaitFor('historyPushState', 'historyStateChanged', {
      state,
      title,
      url,
      action: 'push'
    } as HistoryStateRequest);
  }

  /**
   * Replace current state in iframe history
   */
  async replaceState(state: any, title: string, url: string): Promise<void> {
    await this.sendAndWaitFor('historyReplaceState', 'historyStateChanged', {
      state,
      title,
      url,
      action: 'replace'
    } as HistoryStateRequest);
  }

  /**
   * Get the current history length
   */
  async getHistoryLength(): Promise<number> {
    const response = await this.sendAndWaitFor<{}, HistoryInfoResponse>('getHistoryInfo', 'historyInfo');
    return response.length;
  }

  /**
   * Get the current history state
   */
  async getHistoryState(): Promise<any> {
    const response = await this.sendAndWaitFor<{}, HistoryInfoResponse>('getHistoryInfo', 'historyInfo');
    return response.state;
  }

  /**
   * Get comprehensive history information
   */
  async getHistoryInfo(): Promise<HistoryInfoResponse> {
    return this.sendAndWaitFor<{}, HistoryInfoResponse>('getHistoryInfo', 'historyInfo');
  }

  /**
   * Check if can go back in history
   */
  async canGoBack(): Promise<boolean> {
    const info = await this.getHistoryInfo();
    return info.length > 1;
  }

  /**
   * Check if can go forward in history
   */
  async canGoForward(): Promise<boolean> {
    try {
      // Note: This is a simplified check - in reality, browsers don't expose
      // forward history information for security reasons
      const info = await this.getHistoryInfo();
      return info.length > 1; // Simplified assumption
    } catch {
      return false;
    }
  }

  /**
   * Listen for navigator events
   */
  on<K extends keyof NavigatorEvents>(
    event: K,
    handler: (payload: NavigatorEvents[K]) => void
  ): Disposable {
    return this.onEvent(event, handler);
  }

  /**
   * Listen for navigator events (once)
   */
  once<K extends keyof NavigatorEvents>(
    event: K,
    handler: (payload: NavigatorEvents[K]) => void
  ): void {
    this.onceEvent(event, handler);
  }
}
