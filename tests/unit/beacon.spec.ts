import { afterEach, describe, expect, it, vi } from 'vitest';
import { Beacon } from '../../src/beacon/index.js';

const beacons = new Set<Beacon>();

afterEach(() => {
  for (const beacon of beacons) {
    beacon.dispose();
  }
  beacons.clear();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('Beacon origin restrictions', () => {
  it('rejects messages after an iframe navigates to a different origin', () => {
    let onMessage!: (event: Partial<MessageEvent>) => void;
    vi.stubGlobal('window', {
      addEventListener: (_event: string, handler: typeof onMessage) => { onMessage = handler; },
      removeEventListener: vi.fn(),
    });
    const iframe = { src: 'https://preview.example', contentWindow: {} } as HTMLIFrameElement;
    const beacon = new Beacon(iframe, { targetOrigin: 'https://preview.example' });
    beacons.add(beacon);

    onMessage({ source: iframe.contentWindow, origin: 'https://untrusted.example', data: { type: 'beacon:channel-established' } });
    expect(beacon.isReady).toBe(false);
    onMessage({ source: {} as Window, origin: 'https://preview.example', data: { type: 'beacon:channel-established' } });
    expect(beacon.isReady).toBe(false);
    onMessage({ source: iframe.contentWindow, origin: 'https://preview.example', data: { type: 'beacon:channel-established' } });
    expect(beacon.isReady).toBe(true);
  });

  it('transfers the channel only to the configured origin', async () => {
    vi.useFakeTimers();
    let onMessage!: (event: Partial<MessageEvent>) => void;
    vi.stubGlobal('window', {
      addEventListener: (_event: string, handler: typeof onMessage) => { onMessage = handler; },
      removeEventListener: vi.fn(),
    });
    const port = { start: vi.fn(), close: vi.fn() };
    vi.stubGlobal('MessageChannel', class {
      port1 = port;
      port2 = port;
    });
    const postMessage = vi.fn();
    const iframe = { src: 'https://preview.example', contentWindow: { postMessage } } as unknown as HTMLIFrameElement;
    const beacon = new Beacon(iframe, { targetOrigin: 'https://preview.example' });
    beacons.add(beacon);

    onMessage({ source: iframe.contentWindow, origin: 'https://preview.example', data: { type: 'beacon:ready-for-channel' } });
    expect(postMessage).toHaveBeenCalledWith(expect.any(Object), 'https://preview.example', [port]);
    onMessage({ source: iframe.contentWindow, origin: 'https://preview.example', data: { type: 'beacon:channel-established' } });
    await vi.advanceTimersByTimeAsync(100);
  });
});
