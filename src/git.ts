import { Action, NotebookInstance } from './index.js';

export interface GitLog {
  hash: string;
  message: string;
  author: string;
  date: string;
}

export interface GitRef {
  ref: string;
}

export interface GitEvents {}

export interface GitActions {
  'git.checkpoint': Action<{ author: string; message: string; branch: string }, GitRef>;
  'git.log': Action<{ ref: string }, GitLog[]>;
  'git.sync': Action<{ url: string; ref: string; token?: string; force?: boolean }, GitRef>;
  'git.restore': Action<{ ref: string }, GitRef>;
}

class CommandError extends Error {
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

export default class Git {
  constructor(protected okra: NotebookInstance) {}

  public checkpoint(author: string, message: string, branch = 'main') {
    return this.okra.invoke('git.checkpoint', { author, message, branch });
  }

  public sync(url: string, ref = 'main', token?: string, force = false) {
    return this.okra.invoke('git.sync', { url, ref, token, force });
  }

  public log(ref: string = 'main') {
    return this.okra.invoke('git.log', { ref });
  }

  public restore(ref: string) {
    return this.okra.invoke('git.restore', { ref });
  }
}
