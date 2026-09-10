import type { Client } from './index.js';
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

export type GitReviewFileStatus = 'added' | 'modified' | 'deleted' | 'renamed' | 'copied' | 'untracked';

export interface GitReviewFile {
  path: string;
  oldPath?: string;
  status: GitReviewFileStatus;
  indexStatus: string;
  worktreeStatus: string;
  staged: boolean;
  unstaged: boolean;
}

export interface GitReview extends GitStatus {
  files: GitReviewFile[];
  stagedPatch: string;
  unstagedPatch: string;
  patch: string;
  stagedStat: string;
  unstagedStat: string;
}

export interface GitIndexInput {
  path?: string;
  paths?: string[];
  all?: boolean;
}

export interface GitRevertInput extends GitIndexInput {
  staged?: boolean;
}

export interface GitCredentials {
  url: string;
  username: string;
  password: string;
  token: string;
  abilities: string[];
  expiresAt: string;
}

export type GitProvider = 'github' | (string & {});

export type GitSyncDirection = 'pull' | 'push' | 'both';

export interface GitSyncAuthor {
  name: string;
  email: string;
}

export interface GitTargetConfiguration {
  provider: GitProvider;
  repository: string;
  author: GitSyncAuthor;
  branch?: string;
  setDefault?: boolean;
}

export interface GitSyncExistingTargetInput {
  direction?: GitSyncDirection;
  author?: GitSyncAuthor;
  force?: boolean;
}

export interface GitTargetData {
  id: string;
  provider: GitProvider;
  repository: string;
  url: string | null;
  branch: string;
  default: boolean;
  lastCommitSha: string | null;
  lastSyncedAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export type GitTargetReference = string | GitTarget;

export interface GitCheckoutResult extends GitRef {
  branch: string;
  created: boolean;
}

export interface GitChangedFile {
  path: string;
  oldPath?: string;
  status: string;
}

export interface GitConflict {
  file: string;
  type: string;
  status: string;
  markers?: number;
}

type GitRemoteSource =
  | { url: string; notebookId?: never; target?: never }
  | { notebookId: string; url?: never; target?: never }
  | { target: string; url?: never; notebookId?: never };

export type GitDiffInput = GitRemoteSource & {
  token?: string;
  ref?: string;
  base?: string;
  patch?: boolean;
};

export interface GitDiffPreview {
  status: 'ready' | 'unrelated';
  message?: string;
  baseRef: string;
  targetRef: string;
  mergeBase?: string;
  files: GitChangedFile[];
  patch: string;
  stat: string;
  ahead: number;
  behind: number;
}

export type GitMergeInput = GitRemoteSource & {
  token?: string;
  ref?: string;
  expectedBaseRef?: string;
  author?: string;
  message?: string;
};

export type GitMergeResult =
  | {
    status: 'merged';
    message: string;
    baseRef: string;
    targetRef: string;
    ref: string;
  }
  | {
    status: 'conflict';
    message: string;
    baseRef: string;
    targetRef: string;
    conflicts: GitConflict[];
  }
  | {
    status: 'base_changed';
    message: string;
    expectedBaseRef: string;
    baseRef: string;
  }
  | {
    status: 'up_to_date' | 'unrelated';
    message: string;
    baseRef: string;
    targetRef: string;
    ref?: string;
  };

export interface GitConflictsResult {
  hasConflicts: boolean;
  conflicts: GitConflict[];
}

export type GitResolveInput =
  | { action: 'abort'; author?: string; message?: string }
  | { action: 'continue'; author: string; message?: string };

export interface GitResolveResult {
  ref?: string;
  message: string;
}

export interface GitActions {
  'git.checkpoint': Action<{ author: string; message: string; branch: string; allowEmpty?: boolean }, GitRef>;
  'git.checkout': Action<{ branch: string; create?: boolean }, GitCheckoutResult>;
  'git.log': Action<{ ref: string }, GitLog[]>;
  'git.sync': Action<
    { url: string; author: string; ref: string; token?: string; direction?: 'pull' | 'push' | 'both'; force?: boolean },
    GitRef
  >;
  'git.diff': Action<GitDiffInput, GitDiffPreview>;
  'git.merge': Action<GitMergeInput, GitMergeResult>;
  'git.conflicts': Action<object, GitConflictsResult>;
  'git.resolve': Action<GitResolveInput, GitResolveResult>;
  'git.review': Action<object, GitReview>;
  'git.stage': Action<GitIndexInput, GitReview>;
  'git.unstage': Action<GitIndexInput, GitReview>;
  'git.revert': Action<GitRevertInput, GitReview>;
  'git.restore': Action<{ ref: string }, GitRef>;
  'git.status': Action<object, GitStatus>;
}

export default class Git {
  public readonly targets: GitTargetApi;

  constructor(
    protected okra: NotebookInstance,
    private readonly client: Client
  ) {
    this.targets = new GitTargetApi(okra.data.id, client);
  }

  public checkpoint(author: string, message: string, branch = 'main', allowEmpty = false) {
    return this.okra.invoke('git.checkpoint', { author, message, branch, allowEmpty });
  }

  public checkout(branch: string, create = true) {
    return this.okra.invoke('git.checkout', { branch, create });
  }

  public log(ref: string = 'main') {
    return this.okra.invoke('git.log', { ref });
  }

  public diff(input: GitDiffInput) {
    return this.okra.invoke('git.diff', this.normalizeRemoteInput(input));
  }

  public merge(input: GitMergeInput) {
    return this.okra.invoke('git.merge', this.normalizeRemoteInput(input));
  }

  public conflicts() {
    return this.okra.invoke('git.conflicts', {});
  }

  public abortMerge() {
    return this.okra.invoke('git.resolve', { action: 'abort' });
  }

  public continueMerge(author: string, message?: string) {
    return this.okra.invoke('git.resolve', { action: 'continue', author, message });
  }

  public review() {
    return this.okra.invoke('git.review', {});
  }

  public stage(input: GitIndexInput = { all: true }) {
    return this.okra.invoke('git.stage', input);
  }

  public unstage(input: GitIndexInput = { all: true }) {
    return this.okra.invoke('git.unstage', input);
  }

  public revert(input: GitRevertInput) {
    return this.okra.invoke('git.revert', input);
  }

  public async credentials(): Promise<GitCredentials> {
    const response = await this.client.post<GitCredentials>(`/notebook/${this.okra.data.id}/git/credentials`);

    return response.data;
  }

  public restore(ref: string) {
    return this.okra.invoke('git.restore', { ref });
  }

  public status() {
    return this.okra.invoke('git.status', {});
  }

  private normalizeRemoteInput<T extends { notebookId?: string; target?: string; url?: string }>(input: T): T {
    if (input.notebookId === undefined) {
      return input;
    }

    const notebookId = input.notebookId.trim();
    if (!notebookId) {
      throw new Error("'notebookId' cannot be empty.");
    }

    if (input.url?.trim()) {
      throw new Error("Pass either 'url' or 'notebookId', not both.");
    }

    if (input.target?.trim()) {
      throw new Error("Pass either 'target' or 'notebookId', not both.");
    }

    const { notebookId: _notebookId, ...payload } = input;

    return {
      ...payload,
      url: this.gitUrlForNotebook(notebookId),
    } as T;
  }

  private gitUrlForNotebook(notebookId: string): string {
    const url = new URL(this.okra.data.gitUrl);
    url.username = '';
    url.password = '';
    url.pathname = `/${encodeURIComponent(notebookId)}.git`;
    url.search = '';
    url.hash = '';

    return url.toString();
  }

}

export class GitTargetApi {
  public constructor(
    private readonly notebookId: string,
    private readonly client: Client
  ) { }

  public async create(input: GitTargetConfiguration): Promise<GitTarget> {
    const response = await this.client.post<GitTargetData>(
      `/notebook/${this.notebookId}/git/targets`,
      omitUndefined({ ...input })
    );

    return new GitTarget(response.data, this.notebookId, this.client);
  }

  public async list(): Promise<GitTarget[]> {
    const response = await this.client.get<GitTargetData[]>(`/notebook/${this.notebookId}/git/targets`);

    return response.data.map((target) => new GitTarget(target, this.notebookId, this.client));
  }

  public async get(target: GitTargetReference): Promise<GitTarget> {
    const response = await this.client.get<GitTargetData>(
      `/notebook/${this.notebookId}/git/targets/${encodeURIComponent(gitTargetId(target))}`
    );

    return new GitTarget(response.data, this.notebookId, this.client);
  }

}

export class GitTarget {
  public constructor(
    public readonly data: GitTargetData,
    private readonly notebookId: string,
    private readonly client: Client
  ) { }

  public get id(): string {
    return this.data.id;
  }

  public async sync(input: GitSyncExistingTargetInput = {}): Promise<GitTarget> {
    const response = await this.client.post<GitTargetData>(
      `/notebook/${this.notebookId}/git/targets/${encodeURIComponent(this.id)}/sync`,
      omitUndefined({ ...input })
    );

    return new GitTarget(response.data, this.notebookId, this.client);
  }
}

function gitTargetId(target: GitTargetReference): string {
  return typeof target === 'string' ? target : target.id;
}

function omitUndefined<T extends Record<string, unknown>>(input: T): T {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined)) as T;
}
