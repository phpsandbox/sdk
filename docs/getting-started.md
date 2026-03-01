# Getting Started with PHPSandbox SDK

This guide walks through the fastest path from install to a working notebook.

## Prerequisites

- Node.js 18+
- A PHPSandbox API token

## Install

```bash
npm install @phpsandbox/sdk
```

## 1. Create a Client

```ts
import { PHPSandbox } from '@phpsandbox/sdk';

const token = process.env.PHPSANDBOX_TOKEN;
if (!token) throw new Error('Missing PHPSANDBOX_TOKEN');

const client = new PHPSandbox(token);
```

## 2. Create or Open a Notebook

```ts
// create() initializes by default
const notebook = await client.notebook.create('php');

// open()/get() need ready()
const existing = await client.notebook.open('notebook-id');
await existing.ready();
```

## 3. Write and Read Files

```ts
await notebook.file.write('hello.php', '<?php echo "Hello";');

const data = await notebook.file.readFile('hello.php');
const text = new TextDecoder().decode(data);

console.log(text);
```

If you need binary-safe writes, use `writeFile`:

```ts
await notebook.file.writeFile('binary.dat', new Uint8Array([1, 2, 3]), {
  create: true,
  overwrite: true,
  unlock: false,
  atomic: false,
});
```

## 4. Run Commands

### Terminal (stream output)

```ts
const task = await notebook.terminal.spawn('php', ['hello.php']);
const reader = task.output.getReader();

try {
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    process.stdout.write(value);
  }
} finally {
  reader.releaseLock();
}

const exitCode = await task.exit;
console.log(`\nExit code: ${exitCode}`);
```

### Shell (single command result)

```ts
const result = await notebook.shell.exec('php -v');
result.throw();
console.log(result.output);
```

## 5. Search and Watch Files

```ts
const matches = await notebook.file.find('*.php', {
  includes: ['app/**'],
  excludes: ['vendor/**'],
});

console.log(matches.map((m) => m.path));

const watcher = notebook.file.watch(
  '/app',
  {
    recursive: true,
    excludes: ['vendor/**', 'node_modules/**'],
  },
  (change) => {
    console.log(change.type, change.path);
  }
);

// later
watcher.dispose();
```

## 6. Use Composer and Git

```ts
await notebook.composer.install({ noInteraction: true });
await notebook.composer.require({ packages: ['monolog/monolog'] });

await notebook.git.checkpoint('Jane Doe <jane@example.com>', 'Initial checkpoint');
```

## 7. Clean Up

Always dispose notebook connections when finished:

```ts
notebook.dispose();
```

## Common Pitfalls

- `open()` / `get()` notebooks must call `await notebook.ready()` before tool calls.
- `file.watch()` requires an `excludes` array.
- `shell.exec()` does not throw by default; call `result.throw()` to fail on non-zero exit codes.

## Next Reading

- API overview: `docs/api-summary.md`
- CDN/browser usage: `docs/cdn-usage.md`
- Root quick start: `README.md`
