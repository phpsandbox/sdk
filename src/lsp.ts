import { Action, NotebookInstance } from './index.js';

export interface LspActions {
  'lsp.message': Action<{ message: string; id: string }>;
  'lsp.close': Action<{ id: string }>;
  'lsp.start': Action<{ id: string }>;
}

interface LspEventData {
  'lsp.response': object;
  'lsp.closed': { code: number; reason: string };
  'lsp.error': { message: string };
}

type PrefixKey<K extends keyof LspEventData> = `${K}.${string}`;
export type LspEvents = LspEventData & {
  [K in keyof LspEventData as PrefixKey<K>]: LspEventData[K];
};

export default class Lsp {
  constructor(protected okra: NotebookInstance) {}

  public message(id: string, message: string) {
    return this.okra.invoke('lsp.message', { id, message });
  }

  public listen<T extends keyof LspEventData>(id: string, event: T, cb: (data: LspEventData[T]) => void) {
    this.okra.listen(`${event}.${id}`, (e) => cb(e as LspEventData[T]));
  }

  public onClose(id: string, cb: (code: number, reason: string) => void): void {
    this.listen(id, 'lsp.closed', (e) => cb(e.code, e.reason));
  }

  public onError(id: string, cb: (message: string) => void): void {
    this.listen(id, 'lsp.error', (e) => cb(e.message));
  }

  public onClientDisconnect(cb: (code: number, message: string) => void): void {
    this.okra.onDidDisconnect(() => cb(1000, 'OKRA DISCONNECTED'));
  }

  public onResponse(id: string, cb: (data: string) => void): void {
    this.listen(id, 'lsp.response', (e) => cb(JSON.stringify(e)));
  }

  public close(id: string) {
    return this.okra.invoke('lsp.close', { id });
  }

  public start(id: string) {
    return this.okra.invoke('lsp.start', { id });
  }

  public connection(id: string) {
    return LspConnection.create(id, this);
  }

  public whenSocketConnected() {
    return this.okra.whenConnected();
  }
}

export class LspConnection {
  public constructor(
    public readonly id: string,
    private readonly lsp: Lsp
  ) {}

  public send(content: string) {
    return this.lsp.message(this.id, content);
  }

  public onMessage(cb: (data: string) => void) {
    this.lsp.onResponse(this.id, cb);
  }

  public onError(cb: (message: string) => void) {
    this.lsp.onError(this.id, cb);
  }

  public onClose(cb: (code: number, reason: string) => void) {
    this.lsp.onClose(this.id, cb);
  }

  public dispose() {
    this.lsp.close(this.id);
  }

  public start() {
    this.lsp.start(this.id);
  }

  public onClientDisconnect(cb: (code: number, message: string) => void) {
    this.lsp.onClientDisconnect(cb);
  }

  public whenSocketConnected() {
    return this.lsp.whenSocketConnected();
  }

  public static create(id: string, lsp: Lsp): LspConnection {
    return new LspConnection(id, lsp);
  }
}
