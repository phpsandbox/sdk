import { connectBeacon, type Beacon } from '@phpsandbox/sdk/beacon';

export interface BeaconBrowserInspection {
  readonly id?: string;
  readonly success: boolean;
  readonly tagName?: string;
  readonly textContent?: string;
}

export interface BeaconBrowserEvents {
  readonly console: readonly { readonly args: readonly unknown[]; readonly level: string }[];
  readonly errors: readonly { readonly message: string }[];
  readonly execution: { readonly error?: string; readonly result?: unknown; readonly success: boolean };
}

export interface BeaconBrowserFetch {
  readonly body?: unknown;
  readonly status?: number;
  readonly success: boolean;
}

export interface BeaconBrowserScreenshot {
  readonly byteLength: number;
  readonly size: number;
  readonly success: boolean;
  readonly type?: string;
}

export interface BeaconBrowserNavigation {
  readonly eventUrl: string;
  readonly isReady: boolean;
  readonly url: string;
}

export interface BeaconBrowserBridge {
  captureScreenshot(): Promise<BeaconBrowserScreenshot>;
  connect(previewUrl: string): Promise<{ readonly isReady: boolean }>;
  dispose(): void;
  emitAndReadEvents(marker: string): Promise<BeaconBrowserEvents>;
  fetch(url: string): Promise<BeaconBrowserFetch>;
  inspect(selector: string): Promise<BeaconBrowserInspection>;
  navigate(url: string): Promise<BeaconBrowserNavigation>;
  ping(): Promise<boolean>;
}

declare global {
  interface Window {
    phpsandboxBeaconSmoke: BeaconBrowserBridge;
  }
}

let beacon: Beacon | undefined;
let iframe: HTMLIFrameElement | undefined;

window.phpsandboxBeaconSmoke = {
  async captureScreenshot(): Promise<BeaconBrowserScreenshot> {
    const result = await activeBeacon().captureScreenshot({
      output: { maxHeight: 600, maxWidth: 800 },
      type: 'image/png',
    });

    return {
      byteLength: result.screenshot?.byteLength ?? 0,
      size: result.size ?? 0,
      success: result.success,
      ...(result.type === undefined ? {} : { type: result.type }),
    };
  },

  async connect(previewUrl: string): Promise<{ readonly isReady: boolean }> {
    iframe = document.createElement('iframe');
    iframe.id = 'phpsandbox-beacon-smoke-frame';
    iframe.src = previewUrl;
    iframe.style.height = '600px';
    iframe.style.width = '800px';
    document.body.append(iframe);
    beacon = await connectBeacon(iframe, {
      targetOrigin: new URL(previewUrl).origin,
      timeout: 30_000,
    });

    return { isReady: beacon.isReady };
  },

  dispose(): void {
    beacon?.dispose();
    iframe?.remove();
    beacon = undefined;
    iframe = undefined;
  },

  async emitAndReadEvents(marker: string): Promise<BeaconBrowserEvents> {
    const execution = await activeBeacon().executeCode(`(() => {
      console.log(${JSON.stringify(marker)});
      window.dispatchEvent(new ErrorEvent('error', {
        message: ${JSON.stringify(marker)},
        filename: 'phpsandbox-sdk-beacon-smoke.js',
        lineno: 1,
        colno: 1,
      }));
      return ${JSON.stringify(marker)};
    })()`);
    await delay(100);

    return {
      console: await activeBeacon().getConsoleEvents(),
      errors: await activeBeacon().getErrorEvents(),
      execution,
    };
  },

  async fetch(url: string): Promise<BeaconBrowserFetch> {
    const result = await activeBeacon().fetch({ url });

    return {
      success: result.success,
      ...(result.response === undefined ? {} : {
        body: result.response.body,
        status: result.response.status,
      }),
    };
  },

  async inspect(selector: string): Promise<BeaconBrowserInspection> {
    const result = await activeBeacon().inspectElement(selector);
    const element = result.element as {
      readonly id?: string;
      readonly tagName?: string;
      readonly textContent?: string;
    } | undefined;

    return {
      success: result.success,
      ...(element?.id === undefined ? {} : { id: element.id }),
      ...(element?.tagName === undefined ? {} : { tagName: element.tagName }),
      ...(element?.textContent === undefined ? {} : { textContent: element.textContent }),
    };
  },

  async navigate(url: string): Promise<BeaconBrowserNavigation> {
    const historyChange = new Promise<{ readonly url: string }>((resolve) => {
      activeBeacon().once('historyChange', resolve);
    });
    activeBeacon().navigator.visit(url);
    await activeBeacon().ready();

    return {
      eventUrl: (await historyChange).url,
      isReady: activeBeacon().isReady,
      url: activeBeacon().url,
    };
  },

  async ping(): Promise<boolean> {
    return activeBeacon().ping();
  },
};

function activeBeacon(): Beacon {
  if (beacon === undefined) {
    throw new Error('Beacon smoke browser is not connected.');
  }

  return beacon;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
