export interface EventDispatcher {
    listen: (event: any, callback: (data: any) => void, context?: any) => Disposable;
    once: (event: any, callback: (data: any) => void, context?: any) => void;
    emit: (event: any, ...args: any) => void;
    removeListener: (event?: any, callbackSignature?: any) => void;
}

import mitt, {Emitter, EventHandlerMap, EventType, Handler} from "mitt";
import { Disposable } from "../types.js";

export function mittWithOnce<Events extends Record<EventType, unknown>>(all?: EventHandlerMap<Events>) {
    // @ts-expect-error
    const inst = mitt(all);
    inst.once = (type: keyof Events, fn: Handler<Events[keyof Events]>) => {
        inst.on(type, fn);
        inst.on(type, inst.off.bind(inst, type, fn));
    };
    return inst as unknown as {
        once<Key extends keyof Events>(type: Key, handler: Handler<Events[Key]>): void;
    } & Emitter<Events>;
}

let EE = mittWithOnce();

export default class EventManager implements EventDispatcher {
    public static instance: EventDispatcher;

    public listen(event: any, callback: (data: any) => void): Disposable {
        const dispose = () => {
            this.removeListener(event, callback);
        };

        EE.on(event, callback);

        return {dispose};
    }

    public emit(event: string, data: any): void {
        EE.emit(event, data);
    }

    public once(event: any, callback: (data: any) => void): void {
        EE.once(event, callback);
    }

    public static make(): EventDispatcher {
        return EventManager.instance || (EventManager.instance = new EventManager());
    }

    public static refresh(): EventDispatcher {
        EE.all.clear();
        EE = mittWithOnce();

        return (EventManager.instance = new EventManager());
    }

    public removeListener(event?: any, callbackSignature?: any): void {
        EE.off(event, callbackSignature);
    }

    public static createInstance(): EventDispatcher {
        EE = mittWithOnce();
        EventManager.instance = new EventManager();

        return EventManager.instance;
    }

    public inspect(): any {
        return EE.all;
    }
}
