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
      kind: 'phase',
      restore: { phase: 'downloading', bytesDownloaded: 400, filesRestored: 12, totalBytes: 1000, downloadPercent: 40 },
    };
    const frame = decode(encode({ event: 'init.event', data: payload })) as { event: string; data: NotebookInitProgress };
    emitter.emit(frame.event, frame.data);

    expect(received).toEqual([payload]);
    expect(received[0].restore?.downloadPercent).toBe(40);
  });

  it('keeps unknown sizes and text-only events usable', () => {
    const unknown: NotebookInitProgress = {
      message: 'Restoring your files...',
      restore: { phase: 'downloading', bytesDownloaded: 400, filesRestored: 0, totalBytes: null, downloadPercent: null },
    };
    const legacy: NotebookInitProgress = { message: 'Opening your workspace...' };
    expect(decode(encode(unknown))).toEqual(unknown);
    expect(legacy.restore).toBeUndefined();
  });
});
