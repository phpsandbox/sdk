import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import type { FileChange } from '@phpsandbox/sdk';
import type { SandboxFixture } from '../support/resources.js';
import { createSandboxFixture, operation } from '../support/resources.js';

describe.runIf(process.env.PHPSANDBOX_SMOKE_TRANSPORT === 'realtime').sequential('production realtime-only contract', () => {
  let fixture: SandboxFixture | undefined;

  beforeAll(async () => {
    fixture = await createSandboxFixture('realtime');
  });

  afterAll(async () => {
    await fixture?.resources.cleanup();
  });

  test('receives filesystem watch events', async () => {
    const directory = `.sdk-smoke-watch-${fixture!.sandbox.data.id}`;
    const path = `${directory}/watched.txt`;
    const changes: FileChange[] = [];

    await operation('create watched directory', () => fixture!.sandbox.files.createDirectory(directory));
    fixture!.resources.register(`watched directory ${directory}`, () => (
      fixture!.sandbox.files.remove(directory, { recursive: true })
    ));

    const watcher = await operation('start filesystem watcher', () => fixture!.sandbox.files.watch(directory, {
      recursive: true,
      excludes: [],
    }, (change) => changes.push(change)));
    fixture!.resources.register('filesystem watcher', async () => watcher.dispose());

    await operation('write watched file', () => fixture!.sandbox.files.write(path, 'watch-event'));
    await vi.waitFor(() => {
      expect(changes.some((change) => change.path.endsWith('watched.txt'))).toBe(true);
    }, { timeout: 30_000, interval: 250 });
  });

  test('reconnects and emits connection lifecycle events', async () => {
    let connected = 0;
    let disconnected = 0;
    const connection = fixture!.sandbox.onDidConnect(() => connected += 1);
    const disconnection = fixture!.sandbox.onDidDisconnect(() => disconnected += 1);

    try {
      await operation('reconnect realtime runtime', () => fixture!.sandbox.reconnect());
      await vi.waitFor(() => {
        expect(disconnected).toBeGreaterThan(0);
        expect(connected).toBeGreaterThan(0);
      }, { timeout: 30_000, interval: 250 });
      await expect(operation('execute after reconnect', () => fixture!.sandbox.exec(['php', '-r', 'echo "reconnected";'])))
        .resolves.toMatchObject({ exitCode: 0, stdout: 'reconnected' });
    } finally {
      connection.dispose();
      disconnection.dispose();
    }
  });

  test('streams terminal output and completion', async () => {
    const terminal = await operation('create terminal', () => fixture!.sandbox.terminals.create({
      command: 'php',
      args: ['-r', 'echo "terminal-smoke";'],
    }));
    const output = readTextStream(terminal.output);
    const exitCode = await operation('wait for terminal', () => terminal.wait());

    await expect(output).resolves.toContain('terminal-smoke');
    expect(exitCode).toBe(0);
  });

  test('streams shell output, accepts stdin, and can be killed', async () => {
    const process = fixture!.sandbox.run([
      'php',
      '-r',
      '$line = trim(fgets(STDIN)); fwrite(STDOUT, "stdout:$line"); fwrite(STDERR, "stderr:$line");',
    ]);
    const stdout = readByteStream(process.stdout);
    const stderr = readByteStream(process.stderr);
    const writer = process.stdin.getWriter();

    await writer.write('shell-input\n');
    await writer.close();
    const result = await operation('wait for interactive shell', () => process.wait());

    expect(result.exitCode).toBe(0);
    await expect(stdout).resolves.toContain('stdout:shell-input');
    await expect(stderr).resolves.toContain('stderr:shell-input');

    const longRunning = fixture!.sandbox.run(['php', '-r', 'echo "kill-ready"; sleep(60);']);
    const longRunningOutput = longRunning.stdout.getReader();
    const started = await operation('wait for killable shell', () => longRunningOutput.read());
    expect(new TextDecoder().decode(started.value)).toContain('kill-ready');
    await operation('kill shell process', () => longRunning.kill());
    const killed = await operation('wait for killed shell', () => longRunning.wait());
    expect(killed.exitCode).not.toBe(0);
  });

  test('attaches to a listed active terminal and replays its output', async () => {
    const terminal = await operation('create attachable terminal', () => fixture!.sandbox.terminals.create({
      command: 'php',
      args: ['-r', 'echo "attach-ready\\n"; fgets(STDIN); echo "attach-done\\n";'],
    }));
    const cleanup = fixture!.resources.register(`terminal ${terminal.id}`, async () => {
      await terminal.kill();
    });

    const tasks = await operation('list active terminals', () => fixture!.sandbox.terminals.list());
    expect(tasks.some((task) => task.id === terminal.id)).toBe(true);

    const attached = await operation('attach active terminal', () => fixture!.sandbox.terminals.attach(terminal.id, {
      replayHistory: true,
    }));
    expect(attached).not.toBe(false);
    if (attached === false) {
      throw new Error('Active terminal attachment returned false.');
    }

    const output = attached.output.getReader();
    const replayed = await operation('read attached terminal history', () => output.read());
    expect(replayed.value).toContain('attach-ready');

    const input = attached.input.getWriter();
    await input.write('\n');
    input.releaseLock();
    const completed = await operation('read attached terminal output', async () => {
      for (;;) {
        const chunk = await output.read();
        if (chunk.done || chunk.value.includes('attach-done')) {
          return chunk;
        }
      }
    });
    expect(completed.value).toContain('attach-done');
    await expect(operation('wait for attached terminal completion', () => attached.wait())).resolves.toBe(0);
    await output.cancel();
    cleanup.complete();
  });

  test('streams runtime metrics', async () => {
    const metrics = fixture!.sandbox.runtime.metrics.watch().getReader();
    const metric = await operation('read metrics telemetry', () => metrics.read(), 30_000);
    expect(metric.value).toEqual(expect.objectContaining({ cpu: expect.any(Object), memory: expect.any(Object) }));
    await metrics.cancel();
  });

  test('streams runtime ports', async () => {
    const ports = fixture!.sandbox.runtime.ports.watch().getReader();
    const openedPorts = await operation('read ports telemetry', () => ports.read(), 30_000);
    expect(openedPorts.value).toBeInstanceOf(Array);
    await ports.cancel();
  });

  test('streams runtime logs', async () => {
    const logs = fixture!.sandbox.runtime.logs.follow().getReader();

    try {
      const log = await operation('read runtime log telemetry', async () => {
        for (;;) {
          const entry = await logs.read();
          if (entry.done || entry.value.message.trim() !== '') {
            return entry;
          }
        }
      }, 30_000);
      expect(log.value?.message.trim()).not.toBe('');
    } finally {
      await logs.cancel();
    }
  });

  test('evaluates PHP through the REPL', async () => {
    const result = await operation('evaluate PHP in REPL', () => fixture!.sandbox.repl.eval('return "repl-smoke";'));

    expect(result.exitCode).toBe(0);
  });

  test('controls an active REPL and receives output events', async () => {
    const output: string[] = [];
    const subscription = fixture!.sandbox.repl.onOutput((chunk) => output.push(chunk));

    try {
      const active = fixture!.sandbox.repl.eval('<?php echo "repl-active"; sleep(60);');
      await vi.waitFor(() => expect(output.join('')).toContain('repl-active'), { timeout: 30_000, interval: 250 });

      await operation('resize active REPL', () => fixture!.sandbox.repl.resize(100, 30));
      await operation('write active REPL', () => fixture!.sandbox.repl.write('repl-input\n'));
      await operation('stop active REPL', () => fixture!.sandbox.repl.stop());

      const result = await operation('wait for stopped REPL', () => active);
      expect(result.exitCode).not.toBe(0);
    } finally {
      subscription.dispose();
    }
  });

  test('initializes Intelephense, resolves PHP symbols, and shuts down cleanly', async () => {
    const path = `.sdk-smoke-lsp-${fixture!.sandbox.data.id}.php`;
    const uri = `file:///var/www/${path}`;
    const source = '<?php\nfinal class SdkSmokeSymbol {}\n';
    const connection = fixture!.sandbox.lsp.connection('intelephense');
    const messages: JsonRpcMessage[] = [];
    const errors: string[] = [];
    const closes: Array<{ code: number; reason: string }> = [];
    const messageSubscription = connection.onMessage((message) => messages.push(parseJsonRpcMessage(message)));
    const errorSubscription = connection.onError((message) => errors.push(message));
    const closeSubscription = connection.onClose((code, reason) => closes.push({ code, reason }));

    await operation('write LSP PHP document', () => fixture!.sandbox.files.write(path, source));
    fixture!.resources.register(`LSP document ${path}`, () => fixture!.sandbox.files.remove(path));

    try {
      await operation('wait for realtime connection before LSP start', () => connection.whenSocketConnected());
      await operation('start Intelephense', () => fixture!.sandbox.lsp.start(connection.id));
      await operation('send LSP initialize request', () => connection.send(JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          capabilities: {},
          processId: null,
          rootUri: 'file:///var/www',
          workspaceFolders: [{ name: 'workspace', uri: 'file:///var/www' }],
        },
      })));
      const initialized = await waitForJsonRpcResponse(messages, 1);
      expect(initialized.error).toBeUndefined();
      expect(isRecord(initialized.result) && isRecord(initialized.result.capabilities)).toBe(true);

      await operation('open PHP document in LSP', async () => {
        await connection.send(JSON.stringify({ jsonrpc: '2.0', method: 'initialized', params: {} }));
        await connection.send(JSON.stringify({
          jsonrpc: '2.0',
          method: 'textDocument/didOpen',
          params: { textDocument: { languageId: 'php', text: source, uri, version: 1 } },
        }));
      });
      await operation('request PHP document symbols', () => connection.send(JSON.stringify({
        jsonrpc: '2.0',
        id: 2,
        method: 'textDocument/documentSymbol',
        params: { textDocument: { uri } },
      })));
      const symbols = await waitForJsonRpcResponse(messages, 2);
      expect(symbols.error).toBeUndefined();
      expect(jsonRpcResultContainsName(symbols.result, 'SdkSmokeSymbol')).toBe(true);

      await operation('request LSP shutdown', () => connection.send(JSON.stringify({
        jsonrpc: '2.0',
        id: 3,
        method: 'shutdown',
        params: null,
      })));
      const shutdown = await waitForJsonRpcResponse(messages, 3);
      expect(shutdown.error).toBeUndefined();
      await operation('send LSP exit notification', () => connection.send(JSON.stringify({
        jsonrpc: '2.0',
        method: 'exit',
        params: null,
      })));
      await vi.waitFor(() => expect(closes.length).toBeGreaterThan(0), { timeout: 30_000, interval: 250 });
      expect(errors).toEqual([]);
    } finally {
      await fixture!.sandbox.lsp.close(connection.id);
      messageSubscription.dispose();
      errorSubscription.dispose();
      closeSubscription.dispose();
    }
  });
});

interface JsonRpcMessage {
  readonly error?: unknown;
  readonly id?: number | string | null;
  readonly jsonrpc?: string;
  readonly method?: string;
  readonly result?: unknown;
}

function parseJsonRpcMessage(message: string): JsonRpcMessage {
  const parsed: unknown = JSON.parse(message);
  if (!isRecord(parsed)) {
    throw new TypeError(`LSP emitted a non-object JSON-RPC message: ${message}`);
  }

  return parsed;
}

async function waitForJsonRpcResponse(
  messages: readonly JsonRpcMessage[],
  id: number,
): Promise<JsonRpcMessage> {
  let response: JsonRpcMessage | undefined;

  await vi.waitFor(() => {
    response = messages.find((message) => message.id === id);
    expect(response).toBeDefined();
  }, { timeout: 60_000, interval: 250 });

  if (response === undefined) {
    throw new Error(`LSP response ${id} was not received.`);
  }

  return response;
}

function jsonRpcResultContainsName(result: unknown, expectedName: string): boolean {
  return Array.isArray(result) && result.some((symbol) => (
    isRecord(symbol) && symbol.name === expectedName
  ));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function readTextStream(stream: ReadableStream<string>): Promise<string> {
  let output = '';

  for await (const chunk of stream) {
    output += chunk;
  }

  return output;
}

async function readByteStream(stream: ReadableStream<Uint8Array>): Promise<string> {
  let output = '';

  for await (const chunk of stream) {
    output += new TextDecoder().decode(chunk);
  }

  return output;
}
