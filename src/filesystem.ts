import type { Action, Disposable, NotebookInstance } from './index.js';
import { PHPSandboxError } from './errors/index.js';
import { nanoid } from 'nanoid';

export interface FileResult {
  name: string;
  directory: string;
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

export type FileContents = string | Uint8Array | ReadableStream<Uint8Array> | AsyncIterable<Uint8Array>;

export interface FileListOptions {
  include?: string[];
  exclude?: string[];
}

export interface FileTailOptions {
  lines?: number;
}

export interface FileFollowOptions extends FileTailOptions {
  signal?: AbortSignal;
}

export interface FileLineRange {
  start: number;
  end: number;
}

export interface FileLineRangeResult extends FileLineRange {
  content: string;
  warning?: string;
}

export interface FileDownloadOptions {
  onChunk?: (data: Uint8Array) => void;
  exclude?: string[];
  include?: string[];
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

export interface WatchOptionsWithoutCorrelation {
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
export interface WatchOptions extends WatchOptionsWithoutCorrelation {
  /**
   * If provided, file change events from the watcher that
   * are a result of this watch request will carry the same
   * id.
   */
  readonly correlationId?: number;
}

export enum FileChangeFilter {
  UPDATED = 2,
  ADDED = 4,
  DELETED = 8,
}

/**
 * Possible changes that can occur to a file.
 */
export enum FileChangeType {
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
  'fs.find': Action<{ query: string; options: FileSearchOptions }, FileResult[]>;
  'fs.textSearch': Action<{ query: TextSearchQuery; options: TextSearchOptions }, [boolean, TextSearchMatch[]]>;
  'fs.readFile': Action<
    { path: string; lineRange?: { lineStart: number; lineEnd: number } },
    string | Uint8Array | ReadFileRangeResult
  >;
  'fs.writeFile': Action<{ path: string; contents: Uint8Array; options: FileWriteOptions }, void>;
  'fs.readStream': Action<{ id: string; path: string }, boolean>;
  'fs.cancelRead': Action<{ id: string }, boolean>;
  'fs.follow': Action<{ id: string; path: string; lines: number }, boolean>;
  'fs.cancelFollow': Action<{ id: string }, boolean>;
  'fs.writeStream': Action<{ id: string; path: string; options: FileWriteOptions }, boolean>;
  'fs.writeChunk': Action<{ id: string; contents: Uint8Array }, boolean>;
  'fs.endWrite': Action<{ id: string }, boolean>;
  'fs.abortWrite': Action<{ id: string }, boolean>;
  'fs.stat': Action<{ path: string }, Stats>;
  'fs.rename': Action<{ from: string; to: string; options: FileOverwriteOptions }, void>;
  'fs.delete': Action<{ path: string; options: FileDeleteOptions }, void>;
  'fs.copy': Action<{ source: string; destination: string; options: FileOverwriteOptions }, void>;
  'fs.readDirectory': Action<{ path: string; include: string[]; exclude: string[] }, [string, FileType, number | null][]>;
  'fs.createDirectory': Action<{ path: string }, void>;
  'fs.watch': Action<{ path: string; options: WatchOptions }, void>;
  'fs.download': Action<{ id: string; exclude?: string[]; include?: string[] }, void>;
  'fs.unwatch': Action<{ path: string }, void>;
  'fs.tree': Action<{ path: string }, string>;
  'fs.tail': Action<{ path: string; lines: number }, { content: string }>;
}

interface FilesystemEventData {
  'fs.watch': FileChange;
  'fs.download': Uint8Array;
  'fs.text.search': TextSearchResult | false;
  'fs.read': { id: string; data: Uint8Array };
  'fs.follow': { id: string; data: Uint8Array };
}

type PrefixKey<K extends keyof FilesystemEventData> = `${K}.${string}`;

export type FilesystemEvents = FilesystemEventData & {
  [K in keyof FilesystemEventData as PrefixKey<K>]: FilesystemEventData[K];
};

class FilesystemSubscription {
  private disposed = false;

  public constructor(
    private disposable: Disposable,
    private onDispose: () => void
  ) {}

  public dispose(): void {
    if (this.disposed) {
      return;
    }

    this.disposed = true;
    this.disposable.dispose();
    this.onDispose();
  }
}

export class Filesystem {
  private watches: Map<string, { options: WatchOptions; path: string; onDidChange: (e: FileChange) => void }> = new Map();

  public constructor(
    protected okra: NotebookInstance,
    registerReconnect: ((handler: () => void) => Disposable) | null = (handler) => okra.onDidConnect(handler)
  ) {
    this.registerReconnectHandler(registerReconnect);
  }

  private registerReconnectHandler(registerReconnect: ((handler: () => void) => Disposable) | null): void {
    if (registerReconnect === null) {
      return;
    }

    registerReconnect(() => {
      for (const { path, options } of this.watches.values()) {
        void this.okra.invoke('fs.watch', { path, options }).catch(() => {});
      }
    });
  }

  public async write(
    path: string,
    contents: FileContents,
    options: Partial<FileWriteOptions> = {}
  ): Promise<void> {
    const resolvedOptions: FileWriteOptions = {
      overwrite: true,
      create: true,
      unlock: false,
      atomic: false,
      ...options,
    };
    const source = typeof contents === 'string' ? new TextEncoder().encode(contents) : contents;
    if (this.okra.runtimeTransport === 'rest') {
      const bytes = source instanceof Uint8Array ? source : await collectBytes(source);
      await this.okra.invoke('fs.writeFile', {
        path,
        contents: bytes,
        options: resolvedOptions,
      }).catch((error) => this.handleError(error));
      return;
    }

    const id = nanoid();
    const completion = this.okra.invoke('fs.writeStream', { id, path, options: resolvedOptions });
    void completion.catch(() => {});

    try {
      for await (const chunk of toAsyncIterable(source)) {
        const written = await this.okra.invoke('fs.writeChunk', { id, contents: chunk });
        if (!written) {
          throw new Error(`File write stream ${id} is not available`);
        }
      }

      const ended = await this.okra.invoke('fs.endWrite', { id });
      if (!ended) {
        throw new Error(`File write stream ${id} could not be completed`);
      }
      await completion;
    } catch (error) {
      await this.okra.invoke('fs.abortWrite', { id }).catch(() => false);
      await completion.catch(() => false);
      throw error;
    }
  }

  public async read(path: string): Promise<Uint8Array> {
    try {
      const content = await this.okra.invoke('fs.readFile', { path });
      return content instanceof Uint8Array ? content : new TextEncoder().encode(content as string);
    } catch (error) {
      this.handleError(error);
    }
  }

  public async readText(path: string): Promise<string> {
    return new TextDecoder().decode(await this.read(path));
  }

  public async readLines(path: string, range: FileLineRange): Promise<FileLineRangeResult> {
    try {
      const result = await this.okra.invoke('fs.readFile', {
        path,
        lineRange: {
          lineStart: range.start,
          lineEnd: range.end,
        },
      });

      if (typeof result === 'string' || result instanceof Uint8Array) {
        throw new Error(`Unexpected ranged file response for ${path}`);
      }

      return {
        start: result.lineStart,
        end: result.lineEnd,
        content: result.content,
        ...(result.error === null ? {} : { warning: result.error }),
      };
    } catch (error) {
      this.handleError(error);
    }
  }

  public readStream(path: string): ReadableStream<Uint8Array> {
    if (this.okra.runtimeTransport === 'rest') {
      return new ReadableStream<Uint8Array>({
        start: async (controller) => {
          try {
            controller.enqueue(await this.read(path));
            controller.close();
          } catch (error) {
            controller.error(error);
          }
        },
      });
    }

    const id = nanoid();
    let disposable: Disposable | null = null;
    let closed = false;

    return new ReadableStream<Uint8Array>({
      start: (controller) => {
        disposable = this.okra.listen(`fs.read.${id}`, (event) => {
          controller.enqueue(event.data);
        });

        void this.okra.invoke('fs.readStream', { id, path }).then(() => {
          if (!closed) {
            closed = true;
            disposable?.dispose();
            controller.close();
          }
        }).catch((error) => {
          if (!closed) {
            closed = true;
            disposable?.dispose();
            controller.error(error);
          }
        });
      },
      cancel: async () => {
        if (!closed) {
          closed = true;
          disposable?.dispose();
          await this.okra.invoke('fs.cancelRead', { id }).catch(() => false);
        }
      },
    });
  }

  public follow(path: string, options: FileFollowOptions = {}): ReadableStream<Uint8Array> {
    if (this.okra.runtimeTransport === 'rest') {
      return new ReadableStream<Uint8Array>({
        start(controller) {
          controller.error(new PHPSandboxError('Following files requires the realtime transport.'));
        },
      });
    }

    const id = nanoid();
    let disposable: Disposable | null = null;
    let abort: (() => void) | null = null;
    let started = false;
    let closed = false;

    const stop = async () => {
      if (closed) {
        return;
      }

      closed = true;
      disposable?.dispose();
      disposable = null;
      if (abort && options.signal) {
        options.signal.removeEventListener('abort', abort);
      }
      abort = null;
      if (started) {
        await this.okra.invoke('fs.cancelFollow', { id }).catch(() => false);
      }
    };

    return new ReadableStream<Uint8Array>({
      start: (controller) => {
        disposable = this.okra.listen(`fs.follow.${id}`, (event) => {
          if (!closed) {
            controller.enqueue(event.data);
          }
        });

        if (options.signal) {
          abort = () => {
            void stop().finally(() => controller.error(options.signal?.reason ?? new Error('Aborted')));
          };
          if (options.signal.aborted) {
            abort();
            return;
          }
          options.signal.addEventListener('abort', abort, { once: true });
        }

        started = true;
        void this.okra.invoke('fs.follow', { id, path, lines: options.lines ?? 10 }).then(() => {
          if (!closed) {
            closed = true;
            disposable?.dispose();
            if (abort && options.signal) {
              options.signal.removeEventListener('abort', abort);
            }
            abort = null;
            controller.close();
          }
        }).catch((error) => {
          if (!closed) {
            closed = true;
            disposable?.dispose();
            if (abort && options.signal) {
              options.signal.removeEventListener('abort', abort);
            }
            abort = null;
            controller.error(error);
          }
        });
      },
      cancel: stop,
    });
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
      options: {
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
        ...options,
      },
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

  public tail(path: string, options: FileTailOptions = {}): Promise<string> {
    return this.okra.invoke('fs.tail', { path, lines: options.lines ?? 10 })
      .then(({ content }) => content)
      .catch((e) => this.handleError(e));
  }

  public stat(path: string): Promise<Stats> {
    return this.okra.invoke('fs.stat', { path }).catch((e) => this.handleError(e));
  }

  public move(
    from: string,
    to: string,
    options: Partial<FileOverwriteOptions> = {}
  ): Promise<void> {
    return this.okra.invoke('fs.rename', {
      from,
      to,
      options: { overwrite: false, ...options },
    }).catch((e) => this.handleError(e));
  }

  public remove(
    path: string,
    options: Partial<FileDeleteOptions> = {}
  ): Promise<void> {
    return this.okra.invoke('fs.delete', {
      path,
      options: { recursive: false, useTrash: false, atomic: false, ...options },
    }).catch((e) => this.handleError(e));
  }

  public copy(
    source: string,
    destination: string,
    options: Partial<FileOverwriteOptions> = {}
  ): Promise<void> {
    return this.okra.invoke('fs.copy', {
      source,
      destination,
      options: { overwrite: false, ...options },
    }).catch((e) => this.handleError(e));
  }

  public list(path: string, options: FileListOptions = {}): Promise<[string, FileType, number | null][]> {
    return this.okra.invoke('fs.readDirectory', {
      path,
      include: options.include ?? [],
      exclude: options.exclude ?? [],
    }).catch((e) => this.handleError(e));
  }

  public createDirectory(path: string): Promise<void> {
    return this.okra.invoke('fs.createDirectory', { path }).catch((e) => this.handleError(e));
  }

  public watch(path: string, options: WatchOptions, onDidChange: (e: FileChange) => void): Promise<FilesystemSubscription> {
    const disposable = this.okra.listen(`fs.watch.${path}`, onDidChange);
    const wrappedDisposable = {
      dispose: () => {
        disposable.dispose();
        void this.okra.invoke('fs.unwatch', { path }).catch(() => {});
      },
    };
    const subscription = new FilesystemSubscription(wrappedDisposable, () => {
      const watch = this.watches.get(path);
      if (watch?.onDidChange === onDidChange) {
        this.watches.delete(path);
      }
    });
    this.watches.set(path, { options, path, onDidChange });

    return this.okra
      .invoke('fs.watch', { path, options })
      .then(() => subscription)
      .catch((error) => {
        subscription.dispose();
        throw error;
      });
  }

  public exists(path: string): Promise<boolean> {
    return this.stat(path)
      .then(() => true)
      .catch(() => false);
  }

  public async download(options: FileDownloadOptions = {}): Promise<Blob> {
    const id = nanoid();
    const stream = !!options.onChunk;
    const chunks: Uint8Array[] = [];
    const disposable = this.okra.listen(
      `fs.download.${id}`,
      stream
        ? options.onChunk!
        : (data) => {
            chunks.push(data);
          }
    );

    return this.okra
      .invoke('fs.download', { id, exclude: options.exclude, include: options.include })
      .then(() => new Blob(chunks as BlobPart[], { type: 'application/octet-stream' }))
      .finally(() => disposable.dispose());
  }

  public tree(path: string = '/'): Promise<string> {
    return this.okra.invoke('fs.tree', { path });
  }

  protected handleError(e: unknown): never {
    throw e;
  }
}

async function* toAsyncIterable(contents: Uint8Array | ReadableStream<Uint8Array> | AsyncIterable<Uint8Array>) {
  if (contents instanceof Uint8Array) {
    yield contents;
    return;
  }

  yield* contents;
}

async function collectBytes(stream: ReadableStream<Uint8Array> | AsyncIterable<Uint8Array>): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let length = 0;

  for await (const chunk of stream) {
    chunks.push(chunk);
    length += chunk.byteLength;
  }

  const output = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return output;
}
