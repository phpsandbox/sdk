# PHPSandbox SDK API Summary

This is a quick reference for the current SDK surface.

## Top-Level Client

```ts
import { PHPSandbox } from '@phpsandbox/sdk';

const client = new PHPSandbox(token, 'https://api.phpsandbox.io/v1', {
  debug: false,
  startClosed: true,
});
```

### `NotebookApi`

- `create(template, input?, init = true)`
- `get(id)`
- `open(id)`
- `fork(id)`
- `delete(id)`
- `openFromData(data)`

## `NotebookInstance`

- Lifecycle: `ready()`, `connected()`, `whenConnected()`, `reconnect()`, `dispose()`
- Notebook actions: `fork()`, `delete()`, `stop()`, `restart()`, `ping()`, `update()`
- Events: `listen(event, handler)`, `onDidConnect(handler)`, `onDidDisconnect(handler)`, `onDidInitialize(handler)`
- Raw call: `invoke(action, data?, options?)`

## Services

### Filesystem (`notebook.file`)

- File data: `info()`, `readFile()`, `write()`, `writeFile()`, `tail()`, `stat()`, `exists()`
- File management: `move()`, `rename()`, `copy()`, `remove()`, `delete()`
- Directory: `mkdir()`, `createDirectory()`, `readDirectory()`, `tree()`
- Search: `find()`, `search()`
- Streaming/monitoring: `watch()`, `download()`

### Terminal (`notebook.terminal`)

- Terminal control: `list()`, `start()`, `create()`, `resize()`, `input()`
- Process API: `spawn(command, args, opts?)`
- Events: `listen()`, `onStarted()`, `onOutput(id, handler)`

### Container (`notebook.container`)

- Lifecycle: `start()`, `stop()`, `state()`
- Ports: `openedPorts()`, `onPort(handler)`
- Runtime config: `setPhp(version)`
- Telemetry: `enableTelemetry(features)`, `stopTelemetry()`, `listen(event, handler)`

### Shell (`notebook.shell`)

- `exec(command)` returning `{ output, exitCode }` plus `throw()` helper

### Composer (`notebook.composer`)

- Core: `invoke(command, args?, options?)`
- Helpers: `install()`, `update()`, `require()`, `remove()`, `dumpAutoload()`, `packages()`, `stream(handler)`

### Git (`notebook.git`)

- `checkpoint(author, message, branch = 'main')`
- `sync(url, author, ref?, token?, direction?, force?)`
- `log(ref = 'main')`
- `restore(ref)`

### LSP (`notebook.lsp`)

- Messaging: `start(id)`, `close(id)`, `message(id, payload)`
- Events: `onResponse()`, `onError()`, `onClose()`, `onClientDisconnect()`
- Connection wrapper: `connection(id)`

### REPL (`notebook.repl`)

- `start()`, `stop()`, `eval(code, args?, replOpts?)`, `write(input)`, `resize(cols, rows)`
- Events: `listen()`, `onOutput()`

### Laravel (`notebook.laravel`)

- `maintenanceInfo()`
- `toggleMaintenance(downConfigOrEmptyObject)`

### Auth (`notebook.auth`)

- `login(newConnectionData)`
- `logout()`

### Log (`notebook.log`)

- `stream(handler)`
- `listen(event, handler)`

## Common Errors

- `ApiError` for HTTP API failures
- `NotebookInitError` when notebook initialization returns `type: 'error'`
- `FilesystemError` + `FilesystemErrorType.*` for file system operations
- `RateLimitError` for rate-limited flows

## Notes for Consumers

- `open()` and `get()` do not auto-initialize; call `await notebook.ready()`.
- `create()` and `fork()` initialize by default.
- Always call `notebook.dispose()` when finished.
