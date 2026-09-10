import { describe, expect, it, vi } from 'vitest';
import EventManager from '../../src/events/index.js';

describe('EventManager', () => {
  it('returns a disposable from once listeners', () => {
    const events = EventManager.createInstance();
    const listener = vi.fn();

    const disposable = events.once('ready', listener);
    disposable.dispose();
    events.emit('ready', true);

    expect(listener).not.toHaveBeenCalled();
  });

  it('removes once listeners after the first event', () => {
    const events = EventManager.createInstance();
    const listener = vi.fn();

    events.once('ready', listener);
    events.emit('ready', 'first');
    events.emit('ready', 'second');

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith('first');
  });
});
