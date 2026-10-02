import { describe, expect, it } from 'vitest';
import { encode, decode } from '@msgpack/msgpack';
import { NotebookInstance, type NotebookInitProgress } from '../../src/index.js';
import EventManager from '../../src/events/index.js';

describe('notebook restore progress', () => {
  it('delivers structured progress through the existing initialization listener', () => {
    const emitter = EventManager.createInstance();
    const notebook = Object.create(NotebookInstance.prototype) as NotebookInstance;
    Object.assign(notebook, { emitter, disposables: [] });
    const received: NotebookInitProgress[] = [];
    notebook.listen('init.event', (progress) => received.push(progress));

    const payload: NotebookInitProgress = {
      message: 'Restoring your files...',
      phase: 'downloading',
      download: { totalBytes: 1000, downloadedBytes: 400 },
    };
    const frame = decode(encode({ event: 'init.event', data: payload })) as { event: string; data: NotebookInitProgress };
    emitter.emit(frame.event, frame.data);

    expect(received).toEqual([payload]);
    const progress = received[0];
    if (progress.phase !== 'downloading') throw new Error('Expected download phase');
    expect(progress.download.downloadedBytes / progress.download.totalBytes).toBe(0.4);
  });

  it('keeps known sizes and client-generated text-only events usable', () => {
    const known: NotebookInitProgress = {
      message: 'Restoring your files...',
      phase: 'downloading',
      download: { totalBytes: 1000, downloadedBytes: 400 },
    };
    const legacy: NotebookInitProgress = { message: 'Opening your workspace...' };
    expect(decode(encode(known))).toEqual(known);
    expect(legacy.phase).toBeUndefined();
  });

  it.each(['waiting', 'preparing', 'extracting', 'provisioning', 'starting'] as const)(
    'represents %s without download fields', (phase) => {
      const payload: NotebookInitProgress = { message: phase, phase };
      const decoded = decode(encode(payload));
      expect(decoded).toEqual(payload);
      expect(decoded).not.toHaveProperty('download');
      expect(decoded).not.toHaveProperty('restore');
    }
  );
});
