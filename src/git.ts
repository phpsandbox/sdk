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
  'git.sync': Action<
    { url: string; author: string; ref: string; token?: string; direction?: 'pull' | 'push' | 'both'; force?: boolean },
    GitRef
  >;
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

  public sync(
    url: string,
    author: string,
    ref = 'main',
    token?: string,
    direction: 'pull' | 'push' | 'both' = 'both',
    force = false
  ) {
    return this.okra.invoke('git.sync', { url, author, ref, token, direction, force });
  }

  public log(ref: string = 'main') {
    return this.okra.invoke('git.log', { ref });
  }

  public restore(ref: string) {
    return this.okra.invoke('git.restore', { ref });
  }
}
