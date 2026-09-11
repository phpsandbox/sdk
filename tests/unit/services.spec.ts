import { describe, expect, it, vi } from 'vitest';
import Services from '../../src/services.js';

describe('Service logs', () => {
  it('returns a native readable stream and stops following when cancelled', async () => {
    let listener: ((event: { name: string; output: string }) => void) | null = null;
    const notebook = {
      listen: vi.fn((_event: string, handler: typeof listener) => {
        listener = handler;
        return { dispose: vi.fn() };
      }),
      invoke: vi.fn(async (action: string) => {
        if (action === 'service.logs') {
          listener?.({ name: 'nginx', output: 'ready' });
          return { streaming: true, id: 'logs-1' };
        }
        return true;
      }),
    };
    const stream = new Services(notebook as any).logs('nginx', { follow: true, id: 'logs-1' });
    const reader = stream.getReader();

    await expect(reader.read()).resolves.toEqual({ done: false, value: 'ready' });
    await reader.cancel();

    expect(notebook.invoke).toHaveBeenCalledWith('service.stop-logs', { id: 'logs-1' });
  });
});
