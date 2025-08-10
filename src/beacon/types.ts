// Re-export beacon types for type safety
export interface BeaconMessage<T = any> {
  type: string;
  payload: T;
  timestamp: number;
  source: 'beacon' | 'parent';
  id: string;
}

export interface BeaconConfig {
  enableUrlTracking?: boolean;
  enableConsoleCapture?: boolean;
  enableErrorCapture?: boolean;
  enableDebugMode?: boolean;
  targetOrigin?: string;
}

export interface UrlChangeEvent {
  oldUrl: string;
  newUrl: string;
  timestamp: number;
}

export interface ConsoleEvent {
  level: 'log' | 'warn' | 'error' | 'info' | 'debug';
  args: any[];
  timestamp: number;
  stack?: string;
}

export interface BeaconErrorEvent {
  message: string;
  filename: string;
  lineno: number;
  colno: number;
  error?: Error;
  stack?: string;
  timestamp: number;
}

export interface DebugInfo {
  url: string;
  userAgent: string;
  viewport: { width: number; height: number };
  timestamp: number;
  performance?: {
    navigation: any;
    timing: any;
  };
  console?: ConsoleEvent[];
  errors?: BeaconErrorEvent[];
}

export interface DebugRequest {
  path: string;
  options?: {
    waitForLoad?: boolean;
    captureScreenshot?: boolean;
    captureConsole?: boolean;
    captureNetworkInfo?: boolean;
    timeout?: number;
  };
}

export interface DebugResult {
  success: boolean;
  url: string;
  timestamp: number;
  loadTime?: number;
  screenshot?: ArrayBuffer;
  console: ConsoleEvent[];
  errors: BeaconErrorEvent[];
  networkInfo?: NetworkInfo;
  domInfo?: DOMInfo;
  performanceInfo?: PerformanceInfo;
  error?: string;
}

export interface NetworkInfo {
  resources: Array<{
    name: string;
    type: string;
    size: number;
    duration: number;
    status?: number;
  }>;
  totalRequests: number;
  totalSize: number;
  loadTime: number;
}

export interface DOMInfo {
  title: string;
  elementCount: number;
  headElements: Array<{
    tagName: string;
    attributes: Record<string, string>;
  }>;
  bodySize: {
    scrollWidth: number;
    scrollHeight: number;
    clientWidth: number;
    clientHeight: number;
  };
  metaTags: Array<{
    name?: string;
    property?: string;
    content?: string;
  }>;
}

export interface PerformanceInfo {
  navigationTiming: any;
  loadEventEnd: number;
  domContentLoaded: number;
  firstPaint?: number;
  firstContentfulPaint?: number;
  largestContentfulPaint?: number;
  memoryUsage?: {
    used: number;
    total: number;
  };
}

export interface BeaconActions {
  ping: () => Promise<boolean>;
  getDebugInfo: () => Promise<DebugInfo>;
  getConsoleEvents: () => Promise<ConsoleEvent[]>;
  getErrorEvents: () => Promise<BeaconErrorEvent[]>;
  clearConsole: () => Promise<void>;
  clearErrors: () => Promise<void>;
  executeCode: (code: string) => Promise<{ success: boolean; result?: any; error?: string }>;
  inspectElement: (selector: string) => Promise<{ success: boolean; element?: any; error?: string }>;
  debug: (request: DebugRequest) => Promise<DebugResult>;
}

export interface BeaconEvents {
  ready: BeaconConfig & { url: string; timestamp: number };
  urlChange: UrlChangeEvent;
  console: ConsoleEvent;
  error: BeaconErrorEvent;
  pong: { timestamp: number };
  debugInfo: DebugInfo;
  consoleEvents: ConsoleEvent[];
  errorEvents: BeaconErrorEvent[];
  codeExecutionResult: { success: boolean; result?: any; error?: string };
  elementInspectionResult: { success: boolean; element?: any; error?: string };
  debugResult: DebugResult;
  navigationResult: { success: boolean; error?: string };
  historyNavigated: { success: boolean; error?: string; action?: string };
  historyStateChanged: { success: boolean; error?: string; action?: string; state?: any; title?: string; url?: string };
  historyChange: {
    url: string;
    state: any;
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
  historyInfo: {
    length: number;
    state: any;
    url: string;
    canGoBack: boolean;
    canGoForward: boolean;
  };
}

export interface BeaconOptions {
  timeout?: number;
  targetOrigin?: string;
  debug?: boolean;
}
