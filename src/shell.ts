import { Action, NotebookInstance } from './index.js';

export interface ShellEvents {}

export interface ShellActions {
  'shell.exec': Action<{ command: string }, { output: string; exitCode: number }>;
}

export class CommandError extends Error {
  constructor(
    public output: string,
    public exitCode: number
  ) {
    super(output);
  }
}

class Result {
  constructor(
    public output: string,
    public exitCode: number
  ) {}

  public throw() {
    if (this.exitCode !== 0) {
      throw new CommandError(this.output, this.exitCode);
    }

    return this;
  }
}

export default class Shell {
  constructor(protected okra: NotebookInstance) {}

  public async exec(command: string): Promise<Result> {
    const result = await this.okra.invoke('shell.exec', { command });

    return new Result(result.output, result.exitCode);
  }
}
