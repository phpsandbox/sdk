# PHPSandbox SDK

A comprehensive TypeScript SDK for interacting with cloud-based PHP development environments. The PHPSandbox SDK provides programmatic access to containerized PHP environments with full filesystem, terminal, and development tool integration.

## Table of Contents

- [PHPSandbox SDK](#phpsandbox-sdk)
  - [Table of Contents](#table-of-contents)
  - [Installation](#installation)
  - [Quick Start](#quick-start)
  - [Authentication](#authentication)
  - [Core Concepts](#core-concepts)
    - [Client](#client)
    - [NotebookInstance](#notebookinstance)
    - [Event-Driven Architecture](#event-driven-architecture)
  - [API Reference](#api-reference)
    - [Client](#client-1)
      - [NotebookApi Methods](#notebookapi-methods)
    - [NotebookInstance](#notebookinstance-1)
    - [Filesystem](#filesystem)
      - [File Search Example](#file-search-example)
    - [Terminal](#terminal)
      - [Terminal Usage Example](#terminal-usage-example)
    - [Container](#container)
    - [Language Server Protocol (LSP)](#language-server-protocol-lsp)
    - [Composer](#composer)
    - [Git](#git)
    - [Laravel](#laravel)
    - [REPL](#repl)
    - [Shell](#shell)
    - [Auth](#auth)
    - [Logging](#logging)
  - [Event System](#event-system)
  - [Error Handling](#error-handling)
    - [Common Error Types](#common-error-types)
  - [Examples](#examples)
    - [Complete Laravel Application Setup](#complete-laravel-application-setup)
    - [File Processing Pipeline](#file-processing-pipeline)
    - [Real-time Development Environment](#real-time-development-environment)
  - [TypeScript Support](#typescript-support)
    - [Generic Types](#generic-types)
  - [Support and Contributing](#support-and-contributing)
  - [License](#license)

## Installation

```bash
npm install @phpsandbox/sdk
```

## Quick Start

```typescript
import { PHPSandbox } from '@phpsandbox/sdk';

// Create a client instance
const client = new PHPSandbox('your-api-token');

// Create and initialize a new notebook
const notebook = await client.notebook.create('laravel');

// Access various services
const files = notebook.file;
const terminal = notebook.terminal;
const container = notebook.container;

// Write a PHP file
await files.write('index.php', '<?php echo "Hello World!"; ?>');

// Execute a command
const process = await terminal.spawn('php', ['index.php']);
process.output
  .getReader()
  .read()
  .then(({ value }) => {
    console.log(value); // "Hello World!"
  });
```

## Authentication

The SDK requires an API token for authentication:

```typescript
// Using environment variable (recommended)
const client = new PHPSandbox(process.env.PHPSANDBOX_TOKEN);

// Or direct token
const client = new PHPSandbox('your-token-here');

// Custom API URL (optional)
const client = new PHPSandbox('token', 'https://api.phpsandbox.io/v1');
```

## Core Concepts

### Client

The main entry point for the SDK. Handles authentication and provides access to notebook management.

### NotebookInstance

Represents a containerized PHP environment with access to all development tools:

- **Filesystem**: File operations, search, and monitoring
- **Terminal**: Interactive terminal and process execution
- **Container**: Environment management and monitoring
- **LSP**: Language server integration for IDE features
- **Development Tools**: Composer, Git, Laravel tooling, REPL

### Event-Driven Architecture

The SDK uses WebSocket connections for real-time communication and events.

## API Reference

### Client

```typescript
class PHPSandbox {
  constructor(token: string, url?: string, options?: PHPSandboxClientOptions);

  readonly notebook: NotebookApi;
  readonly http: AxiosInstance;
}
```

#### NotebookApi Methods

```typescript
// Create a new notebook from a template
create(template: string, input?: Partial<CreateNotebookInput>, init?: boolean): Promise<NotebookInstance>

// Get existing notebook by ID
get(id: string): Promise<NotebookInstance>

// Fork an existing notebook
fork(id: string): Promise<NotebookInstance>

// Open and initialize a notebook
open(id: string): Promise<NotebookInstance>

// Create from existing data
openFromData(data: NotebookData): Promise<NotebookInstance>
```

### NotebookInstance

The core class providing access to all development environment features.

```typescript
class NotebookInstance {
  // Core services
  readonly file: Filesystem;
  readonly terminal: Terminal;
  readonly container: Container;
  readonly lsp: Lsp;
  readonly composer: Composer;
  readonly git: Git;
  readonly laravel: Laravel;
  readonly repl: Repl;
  readonly shell: Shell;
  readonly auth: Auth;
  readonly log: Log;

  // Connection management
  ready(): Promise<NotebookInitResult>;
  connected(): Promise<NotebookInstance>;
  reconnect(): void;
  dispose(): void;

  // Event handling
  listen<T extends keyof Events>(event: T, handler: (data: Events[T]) => void): Disposable;
  onDidConnect(handler: () => void): Disposable;
  onDidDisconnect(handler: () => void): Disposable;

  // Direct API calls
  invoke<T extends keyof Invokable>(
    action: T,
    data?: Invokable[T]['args'],
    options?: CallOption
  ): Promise<Invokable[T]['response']>;
}
```

### Filesystem

Comprehensive file system operations with advanced search and monitoring capabilities.

```typescript
class Filesystem {
  // File operations
  readFile(path: string, lineRange?: { lineStart: number; lineEnd: number }): Promise<Uint8Array | ReadFileRangeResult>;
  writeFile(path: string, contents: Uint8Array, options: FileWriteOptions): Promise<void>;
  info(path: string): Promise<FileInfo>;
  stat(path: string): Promise<Stats>;
  exists(path: string): Promise<boolean>;

  // Directory operations
  createDirectory(path: string): Promise<void>;
  readDirectory(path: string, include?: string[], exclude?: string[]): Promise<[string, FileType, number | null][]>;

  // File management
  copy(source: string, destination: string, options: FileOverwriteOptions): Promise<void>;
  move(from: string, to: string): Promise<boolean>;
  rename(from: string, to: string, options: FileOverwriteOptions): Promise<void>;
  delete(path: string, options: FileDeleteOptions): Promise<void>;

  // Search capabilities
  find(query: string, options?: Partial<FileSearchOptions>): Promise<FileResult[]>;
  search(
    query: TextSearchQuery,
    options?: Partial<TextSearchOptions>,
    onMatch?: (result: TextSearchResult | false) => void
  ): Promise<[boolean, TextSearchMatch[]]>;

  // File monitoring
  watch(path: string, options: WatchOptions, onDidChange: (e: FileChange) => void): FilesystemSubscription;

  // Bulk operations
  download(chunk?: (data: Uint8Array) => void, exclude?: string[]): Promise<Blob>;
}
```

#### File Search Example

```typescript
// Find files by name
const phpFiles = await notebook.file.find('*.php', {
  includes: ['src/**'],
  excludes: ['vendor/**'],
  useIgnoreFiles: true,
});

// Full-text search with context
const [hasMore, matches] = await notebook.file.search(
  { pattern: 'function.*authenticate', isRegExp: true },
  { maxResults: 50, beforeContext: 2, afterContext: 2 }
);
```

### Terminal

Interactive terminal with process execution and stream handling.

```typescript
class Terminal {
  // Terminal management
  create(input: TerminalCreateInput): Promise<Task>;
  list(): Promise<Task[]>;
  resize(id: string, size: [number, number]): Promise<boolean>;
  input(id: string, input: string): Promise<void>;

  // Process execution
  spawn(command: string, args: string[], opts?: SpawnOptions): Promise<SandboxProcess & Task>;

  // Event handling
  onStarted(handler: (task: Task) => void): void;
  onOutput(id: string, handler: (data: TerminalEvents['terminal.output']) => void): void;
  listen<T extends keyof TerminalEvents>(event: T, handler: (data: TerminalEvents[T]) => void): Disposable;
}
```

#### Terminal Usage Example

```typescript
// Spawn a process with I/O streams
const process = await notebook.terminal.spawn('composer', ['install'], {
  cwd: '/app',
  env: { COMPOSER_NO_INTERACTION: '1' },
});

// Handle output stream
const reader = process.output.getReader();
while (true) {
  const { done, value } = await reader.read();
  if (done) break;
  console.log(value);
}

// Wait for completion
const exitCode = await process.exit;
console.log(`Process exited with code: ${exitCode}`);
```

### Container

Container lifecycle and resource management.

```typescript
class Container {
  // Container control
  start(): Promise<void>;
  stop(): Promise<void>;
  state(): Promise<{ state: NotebookState }>;

  // Port management
  openedPorts(): Promise<PortInfo[]>;
  onPort(handler: (port: PortInfo, type: 'open' | 'close') => void): Disposable;

  // Environment configuration
  setPhp(version: string): Promise<{ version: string }>;

  // Resource monitoring
  listen<T extends keyof ContainerEvents>(event: T, handler: (data: ContainerEvents[T]) => void): void;
}
```

### Language Server Protocol (LSP)

IDE-like features through Language Server Protocol integration.

```typescript
class Lsp {
  // Connection management
  connection(id: string): LspConnection;
  start(id: string): Promise<void>;
  close(id: string): Promise<void>;

  // Communication
  message(id: string, message: string): Promise<void>;

  // Event handling
  onResponse(id: string, cb: (data: string) => void): void;
  onError(id: string, cb: (message: string) => void): void;
  onClose(id: string, cb: (code: number, reason: string) => void): void;
}

class LspConnection {
  send(content: string): Promise<void>;
  onMessage(cb: (data: string) => void): void;
  onError(cb: (message: string) => void): void;
  onClose(cb: (code: number, reason: string) => void): void;
  start(): Promise<void>;
  dispose(): void;
}
```

### Composer

PHP dependency management integration.

```typescript
class Composer {
  // Package management
  install(packages?: string[]): Promise<void>;
  update(packages?: string[]): Promise<void>;
  remove(packages: string[]): Promise<void>;

  // Project operations
  init(options?: ComposerInitOptions): Promise<void>;
  validate(): Promise<void>;

  // Information
  show(package?: string): Promise<object>;
  outdated(): Promise<object>;

  // Event handling
  listen<T extends keyof ComposerEvents>(event: T, handler: (data: ComposerEvents[T]) => void): Disposable;
}
```

### Git

Version control operations and repository management.

```typescript
class Git {
  // Repository operations
  init(): Promise<void>;
  clone(url: string, directory?: string): Promise<void>;

  // Branch management
  branch(name?: string): Promise<string[] | void>;
  checkout(branch: string): Promise<void>;

  // Staging and commits
  add(files: string[]): Promise<void>;
  commit(message: string): Promise<void>;
  push(remote?: string, branch?: string): Promise<void>;
  pull(remote?: string, branch?: string): Promise<void>;

  // Information
  status(): Promise<GitStatus>;
  log(options?: GitLogOptions): Promise<GitCommit[]>;
  diff(options?: GitDiffOptions): Promise<string>;

  // Event handling
  listen<T extends keyof GitEvents>(event: T, handler: (data: GitEvents[T]) => void): Disposable;
}
```

### Laravel

Laravel-specific development tools and utilities.

```typescript
class Laravel {
  // Artisan commands
  artisan(command: string, args?: string[]): Promise<void>

  // Code generation
  make(type: string, name: string, options?: object): Promise<void>

  // Database operations
  migrate(options?: MigrateOptions): Promise<void>
  seed(class?: string): Promise<void>

  // Cache management
  cache(action: 'clear' | 'config' | 'route' | 'view'): Promise<void>

  // Event handling
  listen<T extends keyof LaravelEvents>(event: T, handler: (data: LaravelEvents[T]) => void): Disposable
}
```

### REPL

Interactive PHP execution environment.

```typescript
class Repl {
  // Code execution
  execute(code: string): Promise<ReplResult>;

  // Session management
  reset(): Promise<void>;

  // Variable inspection
  variables(): Promise<object>;

  // Event handling
  listen<T extends keyof ReplEvents>(event: T, handler: (data: ReplEvents[T]) => void): Disposable;
}
```

### Shell

Shell command execution with customizable environments.

```typescript
class Shell {
  // Command execution
  execute(command: string, options?: ShellOptions): Promise<ShellResult>;

  // Environment management
  setEnv(variables: Record<string, string>): Promise<void>;
  getEnv(): Promise<Record<string, string>>;

  // Working directory
  pwd(): Promise<string>;
  cd(directory: string): Promise<void>;

  // Event handling
  listen<T extends keyof ShellEvents>(event: T, handler: (data: ShellEvents[T]) => void): Disposable;
}
```

### Auth

Authentication and authorization services.

```typescript
class Auth {
  // Token management
  login(credentials: LoginCredentials): Promise<AuthResult>;
  logout(): Promise<void>;
  refresh(): Promise<AuthResult>;

  // User information
  user(): Promise<User>;

  // Permissions
  can(permission: string): Promise<boolean>;
}
```

### Logging

Application logging and monitoring.

```typescript
class Log {
  // Log levels
  debug(message: string, context?: object): Promise<void>;
  info(message: string, context?: object): Promise<void>;
  warning(message: string, context?: object): Promise<void>;
  error(message: string, context?: object): Promise<void>;

  // Log retrieval
  recent(limit?: number): Promise<LogEntry[]>;
  search(query: string, options?: LogSearchOptions): Promise<LogEntry[]>;

  // Event handling
  listen<T extends keyof LogEvents>(event: T, handler: (data: LogEvents[T]) => void): Disposable;
}
```

## Event System

The SDK provides a comprehensive event system for real-time updates:

```typescript
// File system events
notebook.file.watch('/app', { recursive: true }, (change) => {
  console.log(`File ${change.path} was ${change.type}`);
});

// Terminal output
notebook.terminal.onOutput('terminal-id', (data) => {
  console.log(data.output);
});

// Container stats
notebook.container.listen('container.stats', (stats) => {
  console.log(`CPU: ${stats.cpu.usage}/${stats.cpu.limit}`);
});

// Connection events
notebook.onDidConnect(() => {
  console.log('Connected to notebook');
});

notebook.onDidDisconnect(() => {
  console.log('Disconnected from notebook');
});
```

## Error Handling

The SDK provides structured error handling with specific error types:

```typescript
import { FilesystemError, FilesystemErrorType, ErrorEvent } from '@phpsandbox/sdk';

try {
  await notebook.file.readFile('/nonexistent.php');
} catch (error) {
  if (error instanceof FilesystemError && error.name === FilesystemErrorType.FileNotFound) {
    console.log('File not found');
  } else if (error instanceof ErrorEvent) {
    console.log(`Error ${error.code}: ${error.message}`);
  }
}
```

### Common Error Types

- `FilesystemError`: File system operation errors
- `RateLimitError`: API rate limiting
- `NotebookInitError`: Notebook initialization failures
- `ErrorEvent`: Base error class with error codes

## Examples

### Complete Laravel Application Setup

```typescript
import { PHPSandbox } from '@phpsandbox/sdk';

async function setupLaravelApp() {
  const client = new PHPSandbox(process.env.PHPSANDBOX_TOKEN);
  const notebook = await client.notebook.create('laravel');

  // Wait for container to be ready
  await notebook.ready();

  // Install additional dependencies
  await notebook.composer.install(['laravel/sanctum', 'laravel/horizon']);

  // Create a new controller
  await notebook.laravel.make('controller', 'ApiController', { resource: true });

  // Run migrations
  await notebook.laravel.migrate();

  // Set up Git repository
  await notebook.git.init();
  await notebook.git.add(['.']);
  await notebook.git.commit('Initial commit');

  // Start development server
  const server = await notebook.terminal.spawn('php', ['artisan', 'serve', '--host=0.0.0.0']);

  // Monitor for open ports
  notebook.container.onPort((port, type) => {
    if (type === 'open' && port.port === 8000) {
      console.log(`Laravel server available at: ${port.url}`);
    }
  });

  return notebook;
}
```

### File Processing Pipeline

```typescript
async function processPhpFiles(notebook: NotebookInstance) {
  // Find all PHP files
  const phpFiles = await notebook.file.find('*.php', {
    includes: ['app/**', 'src/**'],
    excludes: ['vendor/**', 'node_modules/**'],
  });

  // Process each file
  for (const file of phpFiles) {
    const content = await notebook.file.readFile(file.path);

    // Run PHP CS Fixer
    await notebook.terminal.spawn('php-cs-fixer', ['fix', file.path]);

    // Run static analysis
    const analysis = await notebook.terminal.spawn('phpstan', ['analyse', file.path]);

    // Wait for completion
    await analysis.exit;
  }

  console.log(`Processed ${phpFiles.length} PHP files`);
}
```

### Real-time Development Environment

```typescript
async function createDevelopmentEnvironment() {
  const client = new PHPSandbox(process.env.PHPSANDBOX_TOKEN);
  const notebook = await client.notebook.create('php');

  // Set up file watching
  notebook.file.watch('/app', { recursive: true }, (change) => {
    console.log(`[${new Date().toISOString()}] ${change.path} ${change.type}`);

    // Auto-reload on PHP file changes
    if (change.path.endsWith('.php') && change.type === 'UPDATED') {
      notebook.repl.execute(`include '${change.path}';`);
    }
  });

  // Set up LSP for IDE features
  const lspConnection = notebook.lsp.connection('php-lsp');
  await lspConnection.start();

  lspConnection.onMessage((message) => {
    const data = JSON.parse(message);
    if (data.method === 'textDocument/publishDiagnostics') {
      console.log('Diagnostics:', data.params.diagnostics);
    }
  });

  // Monitor container resources
  notebook.container.listen('container.stats', (stats) => {
    if (stats.memory.usage / stats.memory.limit > 0.8) {
      console.warn('High memory usage detected');
    }
  });

  return notebook;
}
```

## TypeScript Support

The SDK is built with TypeScript and provides comprehensive type definitions:

```typescript
import type {
  NotebookInstance,
  FileInfo,
  Stats,
  TextSearchQuery,
  TerminalCreateInput,
  ContainerStats,
  Events,
  FilesystemEvents,
} from '@phpsandbox/sdk';

// Type-safe event handling
notebook.listen('fs.watch', (change: Events['fs.watch']) => {
  // change is properly typed as FileChange
  console.log(change.path, change.type);
});

// Type-safe API calls
const stats: Stats = await notebook.file.stat('/app/composer.json');
const info: FileInfo = await notebook.file.info('/app/index.php');
```

### Generic Types

```typescript
// Custom event handlers
type CustomEventHandler<T extends keyof Events> = (data: Events[T]) => void;

// Action types
type FileSystemActions = FilesystemActions;
type TerminalActions = TerminalActions;

// Disposable pattern
const disposable: Disposable = notebook.onDidConnect(() => {
  console.log('Connected');
});

// Clean up when done
disposable.dispose();
```

## Support and Contributing

- **Documentation**: [https://docs.phpsandbox.io](https://docs.phpsandbox.io)
- **API Reference**: [https://api.phpsandbox.io/docs](https://api.phpsandbox.io/docs)
- **Issues**: [GitHub Issues](https://github.com/phpsandbox/sdk/issues)
- **Examples**: [GitHub Examples](https://github.com/phpsandbox/examples)

## License

MIT License - see LICENSE file for details.
