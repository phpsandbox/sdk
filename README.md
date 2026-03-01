# PHPSandbox SDK

TypeScript SDK for working with PHPSandbox notebooks: create environments, edit files, run commands, and stream real-time events.

## Installation

```bash
npm install @phpsandbox/sdk
```

Node.js `>=18` is required.

## Quick Start

```ts
import { PHPSandbox } from '@phpsandbox/sdk';

const token = process.env.PHPSANDBOX_TOKEN;
if (!token) throw new Error('Missing PHPSANDBOX_TOKEN');

const client = new PHPSandbox(token);

// create() initializes the notebook by default
const notebook = await client.notebook.create('php');

await notebook.file.write('index.php', '<?php echo "Hello from PHPSandbox";');

const process = await notebook.terminal.spawn('php', ['index.php']);

const reader = process.output.getReader();
let output = '';
try {
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    output += value;
  }
} finally {
  reader.releaseLock();
}

await process.exit;
console.log(output.trim());

// close websocket resources when done
notebook.dispose();
```

## Authentication

Use an API token:

```ts
import { PHPSandbox } from '@phpsandbox/sdk';

const client = new PHPSandbox(process.env.PHPSANDBOX_TOKEN!);
```

Optional constructor args:

```ts
new PHPSandbox('token', 'https://api.phpsandbox.io/v1', {
  debug: false,
  startClosed: true,
});
```

## Notebook Lifecycle

```ts
const client = new PHPSandbox(process.env.PHPSANDBOX_TOKEN!);

const created = await client.notebook.create('laravel');
const opened = await client.notebook.open('notebook-id');
await opened.ready();

const fetched = await client.notebook.get('notebook-id');
await fetched.ready();

const forked = await created.fork();
await forked.delete();
```

Notes:

- `create()` and `fork()` initialize automatically.
- `open()` and `get()` return a notebook instance; call `await notebook.ready()` before using tools.

## Services At A Glance

Each `NotebookInstance` exposes service clients:

- `notebook.file` (`Filesystem`)
- `notebook.terminal` (`Terminal`)
- `notebook.container` (`Container`)
- `notebook.shell` (`Shell`)
- `notebook.composer` (`Composer`)
- `notebook.git` (`Git`)
- `notebook.lsp` (`Lsp`)
- `notebook.repl` (`Repl`)
- `notebook.laravel` (`Laravel`)
- `notebook.auth` (`Auth`)
- `notebook.log` (`Log`)

## Common Operations

### Files

```ts
await notebook.file.write('README.md', '# App');

const raw = await notebook.file.readFile('README.md');
const text = new TextDecoder().decode(raw);

const files = await notebook.file.find('*.php', {
  includes: ['app/**'],
  excludes: ['vendor/**'],
});

const [hasMore, matches] = await notebook.file.search(
  { pattern: 'class\\s+User', isRegExp: true },
  { maxResults: 20, includes: ['app/**'], excludes: ['vendor/**'] }
);
```

### Terminal

```ts
const task = await notebook.terminal.spawn('composer', ['--version']);

task.output.getReader().read().then(({ value }) => {
  console.log(value);
});

const exitCode = await task.exit;
console.log(exitCode);
```

### Shell

```ts
const result = await notebook.shell.exec('php -v');
result.throw();
console.log(result.output);
```

### Composer

```ts
await notebook.composer.install({ noInteraction: true });
await notebook.composer.require({ packages: ['monolog/monolog'] });

const installed = await notebook.composer.packages();
console.log(installed.map((pkg) => pkg.name));
```

### Git

```ts
await notebook.git.checkpoint('Jane Doe <jane@example.com>', 'Initial checkpoint');

await notebook.git.sync(
  'https://github.com/acme/my-repo.git',
  'Jane Doe <jane@example.com>',
  'main',
  process.env.GITHUB_TOKEN,
  'pull'
);

const history = await notebook.git.log('main');
console.log(history[0]);
```

### Events

```ts
const disposeConnect = notebook.onDidConnect(() => {
  console.log('connected');
});

const disposeFs = notebook.file.watch(
  '/app',
  { recursive: true, excludes: ['vendor/**', 'node_modules/**'] },
  (change) => {
    console.log(change.type, change.path);
  }
);

// later
disposeConnect.dispose();
disposeFs.dispose();
```

## Error Handling

```ts
import { ApiError, FilesystemError, FilesystemErrorType } from '@phpsandbox/sdk';

try {
  await notebook.file.readFile('/does-not-exist.php');
} catch (error) {
  if (error instanceof FilesystemError && error.name === FilesystemErrorType.FileNotFound) {
    console.error('Missing file');
  } else if (error instanceof ApiError) {
    console.error(error.status, error.body);
  } else {
    throw error;
  }
}
```

## Browser/CDN Usage

See `docs/cdn-usage.md` for ESM and script-tag examples.

## More Docs

- Getting started walkthrough: `docs/getting-started.md`
- API overview: `docs/api-summary.md`
- Examples: `examples/README.md`

## Support

- Issues: https://github.com/phpsandbox/sdk/issues
- Product docs: https://docs.phpsandbox.io

## License

MIT
