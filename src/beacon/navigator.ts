import type { Disposable } from '../types.js';
import { Beacon } from './index.js';

export interface NavigationResult {
  success: boolean;
  url?: string;
  error?: string;
}

export interface NavigatorActions {
  visit(url: string): void;
  goBack(): Promise<NavigationResult>;
  goForward(): Promise<NavigationResult>;
  canGoBack: boolean;
  canGoForward: boolean;
  refresh(): Promise<void>;
  getCurrentUrl(): string;
  on<K extends keyof NavigatorEvents>(event: K, handler: (payload: NavigatorEvents[K]) => void): Disposable;
}

export interface NavigatorEvents {
  historyChange: {
    url: string;
    state: unknown;
    direction: 'back' | 'forward' | 'push' | 'replace' | 'reload';
    timestamp: number;
  };
  navigationStateChange: {
    canGoBack: boolean;
    canGoForward: boolean;
    currentIndex: number;
    historyLength: number;
    timestamp: number;
  };
}

export interface HistoryNavigationRequest {
  action: 'back' | 'forward' | 'reload';
}

export interface HistoryStateRequest {
  state: unknown;
  title: string;
  url: string;
  action: 'push' | 'replace';
}

export interface HistoryInfoResponse {
  length: number;
  state: unknown;
  url: string;
  canGoBack: boolean;
  canGoForward: boolean;
}

export interface Navigator extends NavigatorActions {
  on<K extends keyof NavigatorEvents>(event: K, handler: (payload: NavigatorEvents[K]) => void): Disposable;
  once<K extends keyof NavigatorEvents>(event: K, handler: (payload: NavigatorEvents[K]) => void): void;
}

/**
 * SDK Navigator implementation with internal history management
 */
export class Navigator implements NavigatorActions {
  private urlHistory: string[] = [];
  private currentIndex = 0;
  private _canGoBack = false;
  private _canGoForward = false;

  constructor(
    private onEvent: <K extends keyof NavigatorEvents>(event: K, handler: (payload: NavigatorEvents[K]) => void) => Disposable,
    private onceEvent: <K extends keyof NavigatorEvents>(event: K, handler: (payload: NavigatorEvents[K]) => void) => void,
    private readonly beacon: Beacon
  ) {
    this.beacon = beacon;
    this.setupUrlChangeListener();
    this.urlHistory.push(beacon.iframe.src);
    this.updateNavigationState();
  }

  /**
   * Navigate to a URL using internal history management
   */
  visit(url: string): void {
    if (!this.beacon) {
      throw new Error('Beacon reference not set');
    }

    // Navigate the iframe
    this.beacon.navigate(url);

    // Add to history (remove any forward history if we're not at the end)
    if (this.currentIndex < this.urlHistory.length - 1) {
      this.urlHistory = this.urlHistory.slice(0, this.currentIndex + 1);
    }

    this.urlHistory.push(url);
    this.currentIndex = this.urlHistory.length - 1;
    this.updateNavigationState();

    // Emit history change event
    this.emitHistoryChange(url, 'push');
  }

  /**
   * Set up listener for URL change events from the beacon
   */
  private setupUrlChangeListener(): void {
    this.beacon.on('urlChange', (payload) => {
      this.addToHistory(payload.newUrl);
    });
  }

  /**
   * Add URL to internal history
   */
  private addToHistory(url: string): void {
    // Remove any forward history if we're not at the end
    if (this.currentIndex < this.urlHistory.length - 1) {
      this.urlHistory = this.urlHistory.slice(0, this.currentIndex + 1);
    }

    // Add new URL
    this.urlHistory.push(url);
    this.currentIndex = this.urlHistory.length - 1;

    // Update navigation state
    this.updateNavigationState();
  }

  /**
   * Update internal navigation state and emit changes
   */
  private updateNavigationState(): void {
    const previousCanGoBack = this._canGoBack;
    const previousCanGoForward = this._canGoForward;

    this._canGoBack = this.currentIndex > 0;
    this._canGoForward = this.currentIndex < this.urlHistory.length - 1;

    // Emit navigation state change if it actually changed
    if (previousCanGoBack !== this._canGoBack || previousCanGoForward !== this._canGoForward) {
      this.emitNavigationStateChange();
    }
  }

  /**
   * Emit navigation state change event
   */
  private emitNavigationStateChange(): void {
    if (this.beacon && this.beacon.emit) {
      this.beacon.emit('navigationStateChange', {
        canGoBack: this._canGoBack,
        canGoForward: this._canGoForward,
        currentIndex: this.currentIndex,
        historyLength: this.urlHistory.length,
        timestamp: Date.now(),
      });
    }
  }

  get canGoBack(): boolean {
    return this._canGoBack;
  }

  get canGoForward(): boolean {
    return this._canGoForward;
  }

  async goBack(): Promise<NavigationResult> {
    if (!this.canGoBack) {
      return { success: false, error: 'Cannot go back - no previous history' };
    }

    this.currentIndex--;
    this.updateNavigationState();
    const url = this.urlHistory[this.currentIndex];

    if (!this.beacon) {
      return { success: false, error: 'Beacon reference not set' };
    }

    this.beacon.navigate(url);
    this.emitHistoryChange(url, 'back');
    return { success: true, url };
  }

  /**
   * Navigate forward in internal history
   */
  async goForward(): Promise<NavigationResult> {
    if (!this.canGoForward) {
      return { success: false, error: 'Cannot go forward - no forward history' };
    }

    this.currentIndex++;
    this.updateNavigationState();
    const url = this.urlHistory[this.currentIndex];

    if (!this.beacon) {
      return { success: false, error: 'Beacon reference not set' };
    }

    this.beacon.navigate(url);
    this.emitHistoryChange(url, 'forward');
    return { success: true, url };
  }

  /**
   * Reload the current page
   */
  async reload(): Promise<void> {
    if (this.currentIndex >= 0 && this.currentIndex < this.urlHistory.length) {
      const currentUrl = this.urlHistory[this.currentIndex];

      if (!this.beacon) {
        throw new Error('Beacon reference not set');
      }

      this.beacon.navigate(currentUrl);
      this.emitHistoryChange(currentUrl, 'reload');
    }
  }

  /**
   * Get current URL from internal history
   */
  getCurrentUrl(): string {
    if (this.currentIndex >= 0 && this.currentIndex < this.urlHistory.length) {
      return this.urlHistory[this.currentIndex];
    }
    return '';
  }

  /**
   * Get the complete history array
   */
  getHistory(): readonly string[] {
    return [...this.urlHistory];
  }

  /**
   * Get current history index
   */
  getCurrentIndex(): number {
    return this.currentIndex;
  }

  /**
   * Check if can go back synchronously
   */
  private canGoBackSync(): boolean {
    return this.currentIndex > 0;
  }

  /**
   * Check if can go forward synchronously
   */
  private canGoForwardSync(): boolean {
    return this.currentIndex < this.urlHistory.length - 1;
  }

  /**
   * Emit history change event
   */
  private emitHistoryChange(url: string, direction: 'back' | 'forward' | 'push' | 'replace' | 'reload'): void {
    // Note: We'll need to emit this through the beacon's event system
    // This would require access to the beacon's emit method
    if (this.beacon && this.beacon.emit) {
      this.beacon.emit('historyChange', {
        url,
        state: null,
        direction,
        timestamp: Date.now(),
      });
    }
  }

  /**
   * Push a new state to internal history (legacy method for compatibility)
   */
  async pushState(state: unknown, title: string, url: string): Promise<void> {
    // For compatibility, treat this as a navigation
    this.visit(url);
  }

  /**
   * Replace current state in internal history (legacy method for compatibility)
   */
  async replaceState(state: unknown, title: string, url: string): Promise<void> {
    if (this.currentIndex >= 0 && this.currentIndex < this.urlHistory.length) {
      // Replace the current URL in history
      this.urlHistory[this.currentIndex] = url;

      if (!this.beacon) {
        throw new Error('Beacon reference not set');
      }

      this.beacon.navigate(url);
      this.emitHistoryChange(url, 'replace');
    } else {
      // If no current history, treat as push
      this.visit(url);
    }
  }

  /**
   * Get the current history length
   */
  async getHistoryLength(): Promise<number> {
    return this.urlHistory.length;
  }

  /**
   * Get the current history state (always null since we don't store state)
   */
  async getHistoryState(): Promise<any> {
    return null;
  }

  /**
   * Get comprehensive history information
   */
  async getHistoryInfo(): Promise<HistoryInfoResponse> {
    return {
      length: this.urlHistory.length,
      state: null,
      url: this.urlHistory[this.currentIndex] || '',
      canGoBack: this.canGoBack,
      canGoForward: this.canGoForward,
    };
  }

  /**
   * Listen for navigator events
   */
  on<K extends keyof NavigatorEvents>(event: K, handler: (payload: NavigatorEvents[K]) => void): Disposable {
    return this.onEvent(event, handler);
  }

  /**
   * Listen for navigator events (once)
   */
  once<K extends keyof NavigatorEvents>(event: K, handler: (payload: NavigatorEvents[K]) => void): void {
    this.onceEvent(event, handler);
  }
}
