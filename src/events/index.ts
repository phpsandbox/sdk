import mitt from 'mitt';
import type { Emitter, EventHandlerMap, EventType, Handler } from 'mitt';
import { Disposable } from '../types.js';

export interface EventDispatcher<Events extends Record<EventType, unknown> = Record<EventType, unknown>> {
  listen: <Key extends keyof Events>(event: Key, callback: Handler<Events[Key]>, context?: unknown) => Disposable;
  once: <Key extends keyof Events>(event: Key, callback: Handler<Events[Key]>, context?: unknown) => Disposable;
  emit: {
    <Key extends keyof Events>(event: Key, payload: Events[Key]): void;
    <Key extends keyof Events>(event: undefined extends Events[Key] ? Key : never): void;
  };
  removeListener: <Key extends keyof Events>(event?: Key, callbackSignature?: Handler<Events[Key]>) => void;
}

const createMitt: <Events extends Record<EventType, unknown>>(all?: EventHandlerMap<Events>) => Emitter<Events> =
  typeof mitt === 'function' ? mitt : mitt.default;

export function mittWithOnce<Events extends Record<EventType, unknown>>(all?: EventHandlerMap<Events>) {
  const inst = createMitt<Events>(all);

  const once = <Key extends keyof Events>(type: Key, fn: Handler<Events[Key]>) => {
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

  return Object.assign(inst, { once });
}

export default class EventManager<
  Events extends Record<EventType, unknown> = Record<EventType, unknown>,
> implements EventDispatcher<Events> {
  private readonly emitter = mittWithOnce<Events>();

  public listen<Key extends keyof Events>(event: Key, callback: Handler<Events[Key]>): Disposable {
    const dispose = () => {
      this.removeListener(event, callback);
    };

    this.emitter.on(event, callback);

    return { dispose };
  }

  public emit<Key extends keyof Events>(event: Key, payload: Events[Key]): void;
  public emit<Key extends keyof Events>(event: undefined extends Events[Key] ? Key : never): void;
  public emit<Key extends keyof Events>(event: Key, ...data: Events[Key][]): void {
    this.emitter.emit(event, data[0]);
  }

  public once<Key extends keyof Events>(event: Key, callback: Handler<Events[Key]>): Disposable {
    return this.emitter.once(event, callback);
  }

  public static make<Events extends Record<EventType, unknown> = Record<EventType, unknown>>(): EventDispatcher<Events> {
    return new EventManager<Events>();
  }

  public static refresh(): EventDispatcher {
    return new EventManager();
  }

  public removeListener<Key extends keyof Events>(event?: Key, callbackSignature?: Handler<Events[Key]>): void {
    if (event === undefined) {
      this.emitter.all.clear();
      return;
    }
    this.emitter.off(event, callbackSignature);
  }

  public static createInstance(): EventDispatcher {
    return new EventManager();
  }

  public inspect(): EventHandlerMap<Events> {
    return this.emitter.all;
  }
}
