import type { Action, Disposable, NotebookInstance } from './index.js';
import { ErrorEvent } from './types.js';
import { nanoid } from 'nanoid';

export interface FileInfo {
  binary: boolean;
  contents: string | null;
  language: string;
}

export interface FileResult {
  name: string;
  directory: string;
  relativePath: string;
  /**
   * Same value as `relativePath`.
   */
  path: string;
}

export enum FileType {
  /**
   * File is unknown (neither file, directory nor symbolic link).
   */
  Unknown = 0,
  /**
   * File is a normal file.
   */
  File = 1,
  /**
   * File is a directory.
   */
  Directory = 2,
  /**
   * File is a symbolic link.
   *
   * Note: even when the file is a symbolic link, you can test for
   * `FileType.File` and `FileType.Directory` to know the type of
   * the target the link points to.
   */
  SymbolicLink = 64,
}

export interface Stats {
  mtime: number;
  size: number;
  ctime: number;
  type: FileType;
  permissions?: number;
}

export interface FileOverwriteOptions {
  overwrite: boolean;
}

export interface FileWriteOptions extends FileOverwriteOptions {
  create: boolean;
  unlock: boolean;
  atomic: false | { postfix: string };
}

export interface FileDeleteOptions {
  recursive: boolean;
  useTrash: boolean;
  atomic: false | { postfix: string };
}

export interface SearchOptions {
  /**
   * The maximum number of results to be returned.
   */
  maxResults?: number;

  /**
   * Files that match an `includes` glob pattern should be included in the search.
   */
  includes: string[];

  /**
   * Files that match an `excludes` glob pattern should be excluded from the search.
   */
  excludes: string[];

  /**
   * Whether external files that exclude files, like .gitignore, should be respected.
   * See the vscode setting `"search.useIgnoreFiles"`.
   */
  useIgnoreFiles: boolean;

  /**
   * Whether symlinks should be followed while searching.
   * See the vscode setting `"search.followSymlinks"`.
   */
  followSymlinks: boolean;

  /**
   * Whether global files that exclude files, like .gitignore, should be respected.
   * See the vscode setting `"search.useGlobalIgnoreFiles"`.
   */
  useGlobalIgnoreFiles: boolean;

  /**
   * Whether files in parent directories that exclude files, like .gitignore, should be respected.
   * See the vscode setting `"search.useParentIgnoreFiles"`.
   */
  useParentIgnoreFiles: boolean;
}

export interface FileSearchOptions extends SearchOptions {
  /**
   * The maximum number of results to be returned.
   */
  maxResults?: number;
}

export interface TextSearchPreviewOptions {
  /**
   * The maximum number of lines in the preview.
   * Only search providers that support multiline search will ever return more than one line in the match.
   */
  matchLines: number;

  /**
   * The maximum number of characters included per line.
   */
  charsPerLine: number;
}

export interface TextSearchQuery {
  id?: string;
  /**
   * The text pattern to search for.
   */
  pattern: string;

  /**
   * Whether or not `pattern` should match multiple lines of text.
   */
  isMultiline?: boolean;

  /**
   * Whether or not `pattern` should be interpreted as a regular expression.
   */
  isRegExp?: boolean;

  /**
   * Whether or not the search should be case-sensitive.
   */
  isCaseSensitive?: boolean;

  /**
   * Whether or not to search for whole word matches only.
   */
  isWordMatch?: boolean;
}

export interface TextSearchOptions extends SearchOptions {
  /**
   * The maximum number of results to be returned.
   */
  maxResults: number;

  /**
   * Options to specify the size of the result text preview.
   */
  previewOptions?: TextSearchPreviewOptions;

  /**
   * Exclude files larger than `maxFileSize` in bytes.
   */
  maxFileSize?: number;

  /**
   * Interpret files using this encoding.
   * See the vscode setting `"files.encoding"`
   */
  encoding?: string;

  /**
   * Number of lines of context to include before each match.
   */
  beforeContext?: number;

  /**
   * Number of lines of context to include after each match.
   */
  afterContext?: number;
}

/**
 * A line of context surrounding a TextSearchMatch.
 */
export interface TextSearchContext {
  /**
   * The uri for the matching document.
   */
  path: string;

  /**
   * One line of text.
   * previewOptions.charsPerLine applies to this
   */
  text: string;

  /**
   * The line number of this line of context.
   */
  lineNumber: number;
}

/**
 * A preview of the text result.
 */
export interface TextSearchMatchPreview {
  /**
   * The matching lines of text, or a portion of the matching line that contains the match.
   */
  text: string;

  /**
   * The Range within `text` corresponding to the text of the match.
   * The number of matches must match the TextSearchMatch's range property.
   */
  matches: SearchRange[];
}

export interface SearchRange {
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
}

/**
 * A match from a text search
 */
export interface TextSearchMatch {
  lineNumber: number;

  /**
   * The uri for the matching document.
   */
  path: string;

  /**
   * The range of the match within the document, or multiple ranges for multiple matches.
   */
  ranges: SearchRange[];

  /**
   * A preview of the text match.
   */
  preview: TextSearchMatchPreview;
}

/**
 * A line of context surrounding a TextSearchMatch.
 */
export interface TextSearchContext {
  /**
   * The uri for the matching document.
   */
  path: string;

  /**
   * One line of text.
   * previewOptions.charsPerLine applies to this
   */
  text: string;

  /**
   * The line number of this line of context.
   */
  lineNumber: number;
}

export type TextSearchResult = TextSearchMatch | TextSearchContext;

interface RelativePattern {
  /**
   * A base file path to which this pattern will be matched against relatively.
   */
  readonly base: string;
  /**
   * A file glob pattern like `*.{ts,js}` that will be matched on file paths
   * relative to the base path.
   *
   * Example: Given a base of `/home/work/folder` and a file path of `/home/work/folder/index.js`,
   * the file glob pattern will match on `index.js`.
   */
  readonly pattern: string;
}

interface WatchOptionsWithoutCorrelation {
  /**
   * Set to `true` to watch for changes recursively in a folder
   * and all of its children.
   */
  recursive: boolean;
  /**
   * A set of glob patterns or paths to exclude from watching.
   * Paths can be relative or absolute and when relative are
   * resolved against the watched folder. Glob patterns are
   * always matched relative to the watched folder.
   */
  excludes: string[];
  /**
   * An optional set of glob patterns or paths to include for
   * watching. If not provided, all paths are considered for
   * events.
   * Paths can be relative or absolute and when relative are
   * resolved against the watched folder. Glob patterns are
   * always matched relative to the watched folder.
   */
  includes?: Array<string | RelativePattern>;
  /**
   * If provided, allows to filter the events that the watcher should consider
   * for emitting. If not provided, all events are emitted.
   *
   * For example, to emit added and updated events, set to:
   * `FileChangeFilter.ADDED | FileChangeFilter.UPDATED`.
   */
  filter?: FileChangeFilter;
}
interface WatchOptions extends WatchOptionsWithoutCorrelation {
  /**
   * If provided, file change events from the watcher that
   * are a result of this watch request will carry the same
   * id.
   */
  readonly correlationId?: number;
}

declare const enum FileChangeFilter {
  UPDATED = 2,
  ADDED = 4,
  DELETED = 8,
}

/**
 * Possible changes that can occur to a file.
 */
export const enum FileChangeType {
  UPDATED = 1,
  ADDED = 2,
  DELETED = 3,
}

/**
 * Identifies a single change in a file.
 */
export interface FileChange {
  /**
   * The type of change that occurred to the file.
   */
  type: FileChangeType;
  /**
   * Whether the change is a file or a directory.
   */
  isFile: boolean;

  /**
   * Whether the file exists.
   */
  exists: boolean;

  /**
   * The unified resource identifier of the file that changed.
   */
  readonly path: string;
  /**
   * If provided when starting the file watcher, the correlation
   * identifier will match the original file watching request as
   * a way to identify the original component that is interested
   * in the change.
   */
  readonly cId?: number;
}

export interface ReadFileRangeResult {
  lineStart: number;
  lineEnd: number;
  content: string;
  error: string | null;
}

export interface FilesystemActions {
  'fs.info': Action<{ path: string }, FileInfo>;
  'fs.write': Action<{ path: string; contents: string }, boolean>;
  'fs.mkdir': Action<{ path: string }, boolean>;
  'fs.remove': Action<{ path: string; type: 'file' | 'directory' }, boolean>;
  'fs.move': Action<{ from: string; to: string }, boolean>;
  'fs.find': Action<{ query: string; options: FileSearchOptions }, FileResult[]>;
  'fs.textSearch': Action<{ query: TextSearchQuery; options: TextSearchOptions }, [boolean, TextSearchMatch[]]>;
  'fs.readFile': Action<
    { path: string; lineRange?: { lineStart: number; lineEnd: number } },
    string | Uint8Array | ReadFileRangeResult
  >;
  'fs.writeFile': Action<{ path: string; contents: Uint8Array; options: FileWriteOptions }, void>;
  'fs.stat': Action<{ path: string }, Stats>;
  'fs.rename': Action<{ from: string; to: string; options: FileOverwriteOptions }, void>;
  'fs.delete': Action<{ path: string; options: FileDeleteOptions }, void>;
  'fs.copy': Action<{ source: string; destination: string; options: FileOverwriteOptions }, void>;
  'fs.readDirectory': Action<{ path: string; include: string[]; exclude: string[] }, [string, FileType, number | null][]>;
  'fs.createDirectory': Action<{ path: string }, void>;
  'fs.watch': Action<{ path: string; options: WatchOptions }, void>;
  'fs.download': Action<{ id: string; exclude: string[] }, void>;
  'fs.unwatch': Action<{ path: string }, void>;
  'fs.tree': Action<{ path: string }, string>;
}

interface FilesystemEventData {
  'fs.watch': FileChange;
  'fs.download': Uint8Array;
  'fs.text.search': TextSearchResult | false;
}

type PrefixKey<K extends keyof FilesystemEventData> = `${K}.${string}`;

export type FilesystemEvents = FilesystemEventData & {
  [K in keyof FilesystemEventData as PrefixKey<K>]: FilesystemEventData[K];
};

export enum FilesystemErrorType {
  Unavailable = 'Unavailable',
  NoPermissions = 'NoPermissions',
  FileExists = 'FileExists',
  FileNotFound = 'FileNotFound',
  FileIsADirectory = 'FileIsADirectory',
  FileNotADirectory = 'FileNotADirectory',
}

export class FilesystemError extends ErrorEvent {
  public constructor(
    inner: ErrorEvent,
    public readonly name: FilesystemErrorType
  ) {
    super(inner.code, inner.message);
  }
}

class FilesystemSubscription {
  public constructor(
    private path: string,
    private okra: NotebookInstance,
    private disposable: Disposable
  ) {}

  public dispose(): void {
    this.okra.invoke('fs.unwatch', { path: this.path });
    this.disposable.dispose();
  }
}

export class Filesystem {
  private watches: Map<string, { options: WatchOptions; path: string; onDidChange: (e: FileChange) => void }> = new Map();

  public constructor(protected okra: NotebookInstance) {
    this.watchOkraConnection();
  }

  private watchOkraConnection(): void {
    this.okra.onDidConnect(() => {
      for (const { path, options, onDidChange } of this.watches.values()) {
        this.watch(path, options, onDidChange);
      }
    });
  }

  public info(path: string): Promise<FileInfo> {
    return this.okra.invoke('fs.info', { path });
  }

  public write(path: string, contents: string): Promise<boolean> {
    return this.okra.invoke('fs.write', { path, contents: contents });
  }

  public find(
    query: string,
    options: Partial<FileSearchOptions> = {
      useIgnoreFiles: false,
      followSymlinks: false,
      useGlobalIgnoreFiles: false,
      useParentIgnoreFiles: false,
    }
  ): Promise<FileResult[]> {
    return this.okra.invoke('fs.find', {
      query,
      options: Object.assign(options, {
        includes: [],
        excludes: [
          '**/storage',
          '**/vendor',
          '**/node_modules',
          '**/.git',
          '**/.svn',
          '**/.hg',
          '**/CVS',
          '**/.DS_Store',
          '**/Thumbs.db',
          '**/*.crswap',
        ],
        useIgnoreFiles: false,
        followSymlinks: false,
        useGlobalIgnoreFiles: false,
        useParentIgnoreFiles: false,
      }),
    });
  }

  public search(
    query: TextSearchQuery,
    options?: Partial<TextSearchOptions>,
    onMatch?: (result: TextSearchResult | false) => boolean | Promise<boolean> | void | Promise<void>
  ): Promise<[boolean, TextSearchMatch[]]> {
    if (!query.id) {
      query.id = nanoid();
    }

    const defaultOptions: TextSearchOptions = {
      maxResults: 5,
      afterContext: 2,
      beforeContext: 2,
      includes: [],
      excludes: [
        '**/.git',
        '**/.svn',
        '**/.hg',
        '**/CVS',
        '**/.DS_Store',
        '**/Thumbs.db',
        '**/*.crswap',
        '**/node_modules',
        '**/vendor',
        '**/bower_components',
        '**/*.code-search',
      ],
      useIgnoreFiles: true,
      followSymlinks: true,
      useGlobalIgnoreFiles: true,
      useParentIgnoreFiles: true,
      encoding: 'utf-8',
      previewOptions: {
        matchLines: 5,
        charsPerLine: 1000,
      },
    };

    const sid = query.id;
    const localOnMatch = async (result: TextSearchResult | false) => {
      if (result === false) {
        disposable.dispose();
      }

      if (onMatch) {
        const ret = await Promise.resolve(onMatch(result));
        if (ret === false) {
          disposable.dispose();
        }
      }
    };

    const disposable = this.okra.listen(`fs.text.search.${sid}`, localOnMatch);

    return this.okra
      .invoke('fs.textSearch', { query, options: { ...defaultOptions, ...options } })
      .finally(() => disposable.dispose());
  }

  public mkdir(path: string): Promise<boolean> {
    return this.okra.invoke('fs.mkdir', { path });
  }

  public move(from: string, to: string): Promise<boolean> {
    return this.okra.invoke('fs.move', { from, to });
  }

  public remove(path: string, type: 'file' | 'directory'): Promise<boolean> {
    return this.okra.invoke('fs.remove', { path, type });
  }

  public readFile(path: string): Promise<Uint8Array>;
  public readFile(path: string, lineRange: { lineStart: number; lineEnd: number }): Promise<ReadFileRangeResult>;
  public async readFile(path: string, lineRange?: { lineStart: number; lineEnd: number }): Promise<Uint8Array | ReadFileRangeResult> {
    try {
      const content = await this.okra.invoke('fs.readFile', { path, lineRange });
      if (content instanceof Uint8Array) {
        return content;
      }

      if (typeof content === 'string') {
        return new TextEncoder().encode(content);
      }

      return content;
    } catch (e) {
      this.handleError(e);
    }
  }

  public writeFile(path: string, contents: Uint8Array, options: FileWriteOptions): Promise<void> {
    return this.okra
      .invoke('fs.writeFile', {
        path,
        contents,
        options,
      })
      .catch((e) => this.handleError(e));
  }

  public stat(path: string): Promise<Stats> {
    return this.okra.invoke('fs.stat', { path }).catch((e) => this.handleError(e));
  }

  public rename(from: string, to: string, options: FileOverwriteOptions): Promise<void> {
    return this.okra.invoke('fs.rename', { from, to, options }).catch((e) => this.handleError(e));
  }

  public delete(path: string, options: FileDeleteOptions): Promise<void> {
    return this.okra.invoke('fs.delete', { path, options }).catch((e) => this.handleError(e));
  }

  public copy(source: string, destination: string, options: FileOverwriteOptions): Promise<void> {
    return this.okra.invoke('fs.copy', { source, destination, options }).catch((e) => this.handleError(e));
  }

  public readDirectory(
    path: string,
    include: string[] = [],
    exclude: string[] = []
  ): Promise<[string, FileType, number | null][]> {
    return this.okra.invoke('fs.readDirectory', { path, include, exclude }).catch((e) => this.handleError(e));
  }

  public createDirectory(path: string): Promise<void> {
    return this.okra.invoke('fs.createDirectory', { path }).catch((e) => this.handleError(e));
  }

  public watch(path: string, options: WatchOptions, onDidChange: (e: FileChange) => void): FilesystemSubscription {
    const disposable = this.okra.listen(`fs.watch.${path}`, onDidChange);
    const wrappedDisposable = {
      dispose: () => {
        disposable.dispose();
        this.okra.invoke('fs.unwatch', { path });
      },
    };
    const subscription = new FilesystemSubscription(path, this.okra, wrappedDisposable);
    this.watches.set(path, { options, path, onDidChange });

    this.okra.invoke('fs.watch', { path, options });

    return subscription;
  }

  public exists(path: string): Promise<boolean> {
    return this.stat(path)
      .then(() => true)
      .catch(() => false);
  }

  public async download(chunk?: (data: Uint8Array) => void, exclude?: string[]): Promise<Blob> {
    const id = nanoid();
    const stream = !!chunk;
    const chunks: Uint8Array[] = [];
    this.okra.listen(
      `fs.download.${id}`,
      stream
        ? chunk
        : (data) => {
            chunks.push(data);
          }
    );

    return this.okra.invoke('fs.download', { id, exclude }).then(() => new Blob(chunks, { type: 'application/octet-stream' }));
  }

  public tree(path: string = '/'): Promise<string> {
    return this.okra.invoke('fs.tree', { path });
  }

  protected handleError(e: unknown): never {
    if (e instanceof ErrorEvent && 'name' in e.raw) {
      throw new FilesystemError(e, e.raw.name as FilesystemErrorType);
    }

    throw e;
  }
}
