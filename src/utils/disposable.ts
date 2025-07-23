import { Disposable } from "src/types.js";

export class NamedDisposable implements Disposable {
    private disposables: Map<string, Disposable> = new Map();

    public add(key: string, disposable: Disposable | (() => Disposable)): void {
        if (this.disposables.has(key)) {
            console.warn(`Disposable with key "${key}" already exists. Disposing the old one.`);
            this.disposables.get(key)?.dispose();
        }

        if (typeof disposable === 'function') {
            disposable = disposable();
        }

        this.disposables.set(key, disposable);
    }

    public dispose(): void {
        this.disposables.forEach((disposable) => disposable.dispose());
        this.disposables.clear();
    }
}
