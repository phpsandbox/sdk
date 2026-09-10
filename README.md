# PHPSandbox SDK

TypeScript SDK for working with PHPSandbox notebooks: create environments, edit files, run commands, and stream real-time events.

## Installation

```bash
npm install @phpsandbox/sdk
```

Node.js `>=18` is required. This package is ESM-only; use `import` rather than `require()`.

## Quick Start

Save this as `quickstart.mjs` and run `node quickstart.mjs` after setting `PHPSANDBOX_TOKEN`. Expected output: `Hello from PHPSandbox`. The example creates and deletes a temporary plain PHP notebook.

```ts
import { PHPSandbox } from '@phpsandbox/sdk';

const token = process.env.PHPSANDBOX_TOKEN;
if (!token) throw new Error('Missing PHPSANDBOX_TOKEN');

const client = PHPSandbox.realtime(token);
const notebook = await client.notebook.create('standard');
await notebook.files.write('hello.php', '<?php echo "Hello from PHPSandbox";');
const result = await notebook.exec('php', ['hello.php']);
console.log(result.stdout.trim());
await notebook.destroy();
```

## Authentication

Sign in to PHPSandbox and open **API keys**. Create a named key and copy it when shown; it cannot be revealed again. API-key access currently requires SDK access to be enabled for your account. Creating or forking notebooks requires an active subscription and available notebook capacity.

Keys from this screen grant account-level notebook read and write access. Keep them in a server environment variable or secret store. Never place them in browser code, notebooks, URLs, logs, or source control. To rotate, create a replacement, update your application, verify it, then revoke the old key.

Use an API key:

```ts
import { PHPSandbox } from '@phpsandbox/sdk';

const client = PHPSandbox.realtime(process.env.PHPSANDBOX_TOKEN!);
```

Explicit realtime and REST clients:

```ts
PHPSandbox.realtime('token', 'https://api.phpsandbox.io/v1', {
  debug: false,
});

// Use explicit request/response runtime actions without a websocket.
PHPSandbox.rest('token', 'https://api.phpsandbox.io/v1', {
  runtimeUrlProvider: async (notebookId) => getFreshRuntimeUrl(notebookId),
});
```

## Notebook Lifecycle

```ts
const client = PHPSandbox.realtime(process.env.PHPSANDBOX_TOKEN!);

const created = await client.notebook.create('laravel');
const fetched = await client.notebook.get('notebook-id');

const forked = await created.fork();
await forked.destroy();

const persistent = await client.notebook.create('laravel', {
  title: 'Persistent Laravel',
  persistent: true,
});

const persistentFork = await created.fork({
  persistent: true,
});

console.log(persistent.data.policy);
console.log(persistentFork.data.policy);
```

Notes:

- Runtime actions wait for the sandbox to become ready before Okra handles them.
- Call `ready()` explicitly only when you need provisioning results such as the preview URL or opened ports.
- API notebook creates and forks are ephemeral by default. `persistent: true` requires an entitled account.
- Use `NotebookData.runtimeUrl`, `runtimeUrlProvider`, and `PublicationData.eventStreamUrl` for runtime access.

## Services At A Glance

Each `NotebookInstance` exposes service clients:

- `notebook.files` (`Filesystem`)
- `notebook.terminals` (`Terminals`)
- `notebook.runtime` (lifecycle, configuration, logs, metrics, and ports)
- `notebook.config` (`Config`)
- `notebook.secrets` (runtime secrets)
- `notebook.preview` (preview access and sessions)
- `notebook.composer` (`Composer`)
- `notebook.git` (`Git`)
- `notebook.integrations` (`SandboxIntegrationApi`)
- `notebook.lsp` (`Lsp`)
- `notebook.repl` (`Repl`)
- `notebook.auth` (`Auth`)
- `notebook.services` (`Services`)
- `notebook.mail` (`NotebookMail`)
- `notebook.feedback` (`Feedback`)

Notes:

- `terminals.create()` is the TTY-oriented process API; `notebook.exec()` and `notebook.run()` are the native non-TTY process APIs.
- `notebook.repl.eval()` evaluates PHP without exposing the unsupported `repl.start` action.

## Common Operations

### Files

```ts
await notebook.files.write('README.md', '# App');

await notebook.files.write('archive.zip', byteStream);
for await (const chunk of notebook.files.readStream('archive.zip')) {
  consume(chunk);
}

const raw = await notebook.files.read('README.md');
const text = await notebook.files.readText('README.md');
const excerpt = await notebook.files.readLines('storage/logs/laravel.log', {
  start: 100,
  end: 200,
});

const files = await notebook.files.find('*.php', {
  includes: ['app/**'],
  excludes: ['vendor/**'],
});

const [hasMore, matches] = await notebook.files.search(
  { pattern: 'class\\s+User', isRegExp: true },
  { maxResults: 20, includes: ['app/**'], excludes: ['vendor/**'] }
);
```

### Terminal

```ts
const task = await notebook.terminals.create({ command: 'composer', args: ['--version'] });

task.output.getReader().read().then(({ value }) => {
  console.log(value);
});

const exitCode = await task.wait();
console.log(exitCode);
```

### Shell

```ts
const result = await notebook.exec('php -v');
if (result.exitCode !== 0) throw new Error(result.stderr || result.output);

const process = notebook.run('php -v', { tty: false });
for await (const chunk of process.output) {
  console.log(chunk.source, new TextDecoder().decode(chunk.data));
}
const processResult = await process.wait();
if (processResult.exitCode !== 0) throw new Error(processResult.stderr || processResult.output);
```

### Services

```ts
import { notebookBuiltinServices } from '@phpsandbox/sdk';

const services = await notebook.services.list();

console.log(notebookBuiltinServices); // ['redis']

await notebook.services.run('redis');
await notebook.services.run('queue', 'php artisan queue:work');

const snapshot = await notebook.services.logs('redis', { tail: 50 });
console.log(snapshot);

const stream = notebook.services.logs('redis', { follow: true, tail: 25 });
const reader = stream.getReader();
const chunk = await reader.read();
console.log(chunk.value);
await reader.cancel();
```

### Runtime observability

```ts
const currentPorts = await notebook.runtime.ports.list();
const futurePort = await notebook.runtime.ports.resolve(4848);
const currentMetrics = await notebook.runtime.metrics.current();

for await (const sample of notebook.runtime.metrics.watch({ signal })) {
  console.log(sample.cpu, sample.memory, sample.disk);
}

for await (const ports of notebook.runtime.ports.watch({ signal })) {
  console.log(ports);
}

for await (const entry of notebook.runtime.logs.follow({ signal })) {
  console.log(entry.timestamp, entry.source, entry.message);
}
```

### Composer

```ts
const install = notebook.composer.run('install');
for await (const chunk of install.output) {
  console.log(chunk.source, new TextDecoder().decode(chunk.data));
}
const installResult = await install.wait();
if (installResult.exitCode !== 0) throw new Error(installResult.stderr || installResult.output);

const requireResult = await notebook.composer.run('require', { packages: ['monolog/monolog'] }).wait();
if (requireResult.exitCode !== 0) throw new Error(requireResult.stderr || requireResult.output);

const installed = await notebook.composer.packages();
console.log(installed.map((pkg) => pkg.name));
```

### Git

```ts
await notebook.git.checkpoint('Jane Doe <jane@example.com>', 'Initial checkpoint');

const github = await client.integrations.link({
  provider: 'github',
  authorization: { type: 'token', token: process.env.GITHUB_TOKEN! },
});
await notebook.integrations.attach({ integration: github });

const target = await notebook.git.targets.create({
  provider: 'github',
  repository: 'acme/my-repo',
  author: { name: 'Jane Doe', email: 'jane@example.com' },
  branch: 'main',
});
await target.sync();

const history = await notebook.git.log('main');
console.log(history[0]);

const review = await notebook.git.review();
await notebook.git.stage({ paths: review.files.filter((file) => file.unstaged).map((file) => file.path) });
await notebook.git.unstage({ path: 'README.md' });
await notebook.git.revert({ path: 'README.md' });
await notebook.git.revert({ path: 'staged-file.php', staged: true });

const fork = await notebook.fork();
const preview = await notebook.git.diff({
  notebookId: fork.data.id,
  token: process.env.PHPSANDBOX_TOKEN,
});

if (preview.status === 'ready') {
  const result = await notebook.git.merge({
    notebookId: fork.data.id,
    token: process.env.PHPSANDBOX_TOKEN,
    expectedBaseRef: preview.baseRef,
    author: 'PHPSandbox <hi@phpsandbox.io>',
    message: 'Merge fork into base',
  });

  if (result.status === 'conflict') {
    console.log(result.conflicts);
  }
}
```

Use `notebookId` when diffing or merging from another PHPSandbox notebook. Use `url` for external Git remotes. `notebookId`, `url`, and `target` are mutually exclusive.
Set `patch: false` when only the structured file list, stat, and divergence counts are needed. Patch generation defaults to enabled for backward compatibility.

Fork diff requires the base and fork to share Git history. If they do not, `diff()` returns `status: 'unrelated'`.

### Mail

```ts
const state = await notebook.mail.status();

if (!state.enabled) {
  await notebook.mail.enable();
}

const mails = await notebook.mail.list();
const mail = await notebook.mail.get(mails.data[0].hash);

await notebook.mail.delete(mail.hash);
await notebook.mail.disable();
```

### Feedback

```ts
await notebook.feedback.configure({
  widget: {
    targets: ['preview', 'publication'],
    types: ['bug', 'suggestion', 'question'],
  },
});

const feedback = await notebook.feedback.submit({
  type: 'bug',
  message: 'Saving the profile failed.',
  author: { externalId: 'customer-42', email: 'ada@example.com' },
  context: { url: 'https://app.example.com/profile', path: '/profile' },
});

await notebook.feedback.update(feedback.id, { status: 'resolved' });
```

The server-side SDK uses the same PHPSandbox API token as the rest of the sandbox. Set `widget: null` to remove the optional popout without disabling API ingestion.

### Events

```ts
const disposeConnect = notebook.onDidConnect(() => {
  console.log('connected');
});

const disposeFs = await notebook.files.watch(
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
import { RemoteError, TransportError } from '@phpsandbox/sdk';

try {
  await notebook.files.read('/does-not-exist.php');
} catch (error) {
  if (RemoteError.is(error, 'FileNotFound')) {
    console.error('Missing file');
  } else if (RemoteError.isValidation(error)) {
    console.error(error.details.errors);
  } else if (error instanceof RemoteError) {
    console.error(error.source, error.status, error.code, error.message);
  } else if (error instanceof TransportError) {
    console.error(error.code, error.cause);
  } else {
    throw error;
  }
}
```

## Support

- Issues: https://github.com/phpsandbox/sdk/issues
- Product docs: https://phpsandbox.io/docs

## License

MIT
