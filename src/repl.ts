import { Action, Disposable, NotebookInstance } from './index.js';

interface ReplOption {
  prependWith?: string;
  appendWith?: string;
}

export interface EvalResult {
  exitCode: number;
  args: string;
}

export interface ReplActions {
  'repl.eval': Action<{ code: string; args: string; repl: ReplOption }, EvalResult>;
  'repl.write': Action<{ input: string }>;
  'repl.stop': Action<{}, void>;
  'repl.resize': Action<{ cols: number; rows: number }>;
}

export interface ReplEvents {
  'repl.output': string;
}

export default class Repl {
  constructor(protected okra: NotebookInstance) {}

  public eval(code: string, args: string = '', repl: ReplOption = { prependWith: '', appendWith: '' }) {
    return this.okra.invoke('repl.eval', { code, args, repl });
  }

  public write(input: string) {
    return this.okra.invoke('repl.write', { input });
  }

  public stop() {
    return this.okra.invoke('repl.stop');
  }

  public resize(cols: number, rows: number) {
    return this.okra.invoke('repl.resize', { cols, rows });
  }

  public listen<T extends keyof ReplEvents>(event: T, handler: (data: ReplEvents[T]) => void): Disposable {
    return this.okra.listen(event, handler);
  }

  public onOutput(handler: (data: ReplEvents['repl.output']) => void): Disposable {
    return this.okra.listen('repl.output', handler);
  }
}
