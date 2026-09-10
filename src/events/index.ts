import * as MittModule from 'mitt';
import type { Emitter, EventHandlerMap, EventType, Handler } from 'mitt';
import { Disposable } from '../types.js';

export interface EventDispatcher {
  listen: (event: EventType, callback: Handler<unknown>, context?: unknown) => Disposable;
  once: (event: EventType, callback: Handler<unknown>, context?: unknown) => Disposable;
  emit: (event: EventType, ...args: unknown[]) => void;
  removeListener: (event?: EventType, callbackSignature?: Handler<unknown>) => void;
}

type MittFactory = typeof import('mitt').default;

const createMitt = ((MittModule as unknown as { default?: MittFactory }).default ?? MittModule) as MittFactory;

export function mittWithOnce<Events extends Record<EventType, unknown>>(all?: EventHandlerMap<Events>) {
  const inst = createMitt<Events>(all) as Emitter<Events> & {
    once<Key extends keyof Events>(type: Key, handler: Handler<Events[Key]>): Disposable;
  };

  inst.once = <Key extends keyof Events>(type: Key, fn: Handler<Events[Key]>) => {
    const onceHandler: Handler<Events[Key]> = (event) => {
      inst.off(type, onceHandler);
      fn(event);
    };

    inst.on(type, onceHandler);

    return {
      dispose: () => {
        inst.off(type, onceHandler);
      },
    };
  };

  return inst;
}

export default class EventManager implements EventDispatcher {
  private readonly emitter = mittWithOnce();

  public listen(event: EventType, callback: Handler<unknown>): Disposable {
    const dispose = () => {
      this.removeListener(event, callback);
    };

    this.emitter.on(event, callback);

    return { dispose };
  }

  public emit(event: EventType, ...data: unknown[]): void {
    this.emitter.emit(event, data.length > 1 ? data : data[0]);
  }

  public once(event: EventType, callback: Handler<unknown>): Disposable {
    return this.emitter.once(event, callback);
  }

  public static make(): EventDispatcher {
    return new EventManager();
  }

  public static refresh(): EventDispatcher {
    return new EventManager();
  }

  public removeListener(event?: EventType, callbackSignature?: Handler<unknown>): void {
    this.emitter.off(event, callbackSignature);
  }

  public static createInstance(): EventDispatcher {
    return new EventManager();
  }

  public inspect(): EventHandlerMap<Record<EventType, unknown>> {
    return this.emitter.all;
  }
}
