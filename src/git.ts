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

export interface GitStatus {
  initialized: boolean;
  clean: boolean;
  branch: string;
  ref: string;
}

export interface GitCheckoutResult extends GitRef {
  branch: string;
  created: boolean;
}

export interface GitEvents {}

export interface GitActions {
  'git.checkpoint': Action<{ author: string; message: string; branch: string; allowEmpty?: boolean }, GitRef>;
  'git.checkout': Action<{ branch: string; create?: boolean }, GitCheckoutResult>;
  'git.log': Action<{ ref: string }, GitLog[]>;
  'git.sync': Action<
    { url: string; author: string; ref: string; token?: string; direction?: 'pull' | 'push' | 'both'; force?: boolean },
    GitRef
  >;
  'git.restore': Action<{ ref: string }, GitRef>;
  'git.status': Action<object, GitStatus>;
}

export default class Git {
  constructor(protected okra: NotebookInstance) {}

  public checkpoint(author: string, message: string, branch = 'main', allowEmpty = false) {
    return this.okra.invoke('git.checkpoint', { author, message, branch, allowEmpty });
  }

  public checkout(branch: string, create = true) {
    return this.okra.invoke('git.checkout', { branch, create });
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

  public status() {
    return this.okra.invoke('git.status', {});
  }
}
