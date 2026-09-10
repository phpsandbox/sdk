import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { FileType } from '@phpsandbox/sdk';
import type { SandboxFixture } from '../support/resources.js';
import { createSandboxFixture, operation } from '../support/resources.js';

describe.sequential('production filesystem contract', () => {
  let fixture: SandboxFixture | undefined;
  let directory = '';
  let source = '';

  beforeAll(async () => {
    fixture = await createSandboxFixture('filesystem');
    directory = `.sdk-smoke-files-${fixture.sandbox.data.id}`;
    source = `${directory}/source.txt`;
    await operation('create smoke directory', () => fixture!.sandbox.files.createDirectory(directory));
    fixture.resources.register(`directory ${directory}`, () => fixture!.sandbox.files.remove(directory, { recursive: true }));
  });

  afterAll(async () => {
    await fixture?.resources.cleanup();
  });

  test('creates, writes, stats, lists, and reads files', async () => {
    await operation('write source file', () => fixture!.sandbox.files.write(source, 'alpha\nbeta\ngamma\n'));

    const stat = await operation('stat source file', () => fixture!.sandbox.files.stat(source));
    const entries = await operation('list smoke directory', () => fixture!.sandbox.files.list(directory));
    const lines = await operation('read source lines', () => fixture!.sandbox.files.readLines(source, { start: 1, end: 2 }));

    expect(stat.type & FileType.File).toBe(FileType.File);
    expect(stat.size).toBeGreaterThan(0);
    expect(entries.map(([name]) => name)).toContain('source.txt');
    expect(lines.content).toContain('beta');
  });

  test('copies, moves, and removes files', async () => {
    const copy = `${directory}/copy.txt`;
    const moved = `${directory}/moved.txt`;

    await operation('copy source file', () => fixture!.sandbox.files.copy(source, copy));
    await operation('move copied file', () => fixture!.sandbox.files.move(copy, moved));

    await expect(operation('read moved file', () => fixture!.sandbox.files.readText(moved)))
      .resolves.toBe('alpha\nbeta\ngamma\n');
    await expect(operation('check copied path', () => fixture!.sandbox.files.exists(copy))).resolves.toBe(false);

    await operation('remove moved file', () => fixture!.sandbox.files.remove(moved));
    await expect(operation('check removed path', () => fixture!.sandbox.files.exists(moved))).resolves.toBe(false);
  });

  test('tails, finds, searches, and renders a tree', async () => {
    const tail = await operation('tail source file', () => fixture!.sandbox.files.tail(source, { lines: 1 }));
    const files = await operation('find source file', () => fixture!.sandbox.files.find('source.txt', { maxResults: 10 }));
    const [_hasMore, matches] = await operation('search source file', () => fixture!.sandbox.files.search({
      pattern: 'beta',
      isRegExp: false,
      isCaseSensitive: true,
    }, {
      includes: [`${directory}/**`],
    }));
    const tree = await operation('render smoke directory tree', () => fixture!.sandbox.files.tree(directory));

    expect(tail).toContain('gamma');
    expect(files.some((file) => file.path.endsWith(source))).toBe(true);
    expect(matches.length).toBeGreaterThan(0);
    expect(tree).toContain('source.txt');
  });

  test('reads file content as a stream', async () => {
    const chunks: Uint8Array[] = [];

    await operation('stream source file', async () => {
      for await (const chunk of fixture!.sandbox.files.readStream(source)) {
        chunks.push(chunk);
      }
    });

    const length = chunks.reduce((total, chunk) => total + chunk.length, 0);
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }

    expect(new TextDecoder().decode(bytes)).toBe('alpha\nbeta\ngamma\n');
  });

  test('round-trips binary file content without changing bytes', async () => {
    const path = `${directory}/binary.dat`;
    const expected = new Uint8Array([0, 1, 2, 127, 128, 254, 255]);

    await operation('write binary file', () => fixture!.sandbox.files.write(path, expected));
    await expect(operation('read binary file', () => fixture!.sandbox.files.read(path))).resolves.toEqual(expected);
  });

  test.runIf(process.env.PHPSANDBOX_SMOKE_TRANSPORT === 'realtime')('downloads the selected smoke directory as an archive', async () => {
    const chunks: Uint8Array[] = [];

    await operation('download smoke directory', () => fixture!.sandbox.files.download({
      include: [`${directory}/**`],
      onChunk: (chunk) => chunks.push(chunk),
    }));

    expect(chunks.reduce((size, chunk) => size + chunk.byteLength, 0)).toBeGreaterThan(0);
  });

  test.runIf(process.env.PHPSANDBOX_SMOKE_TRANSPORT === 'realtime')('follows appended file content', async () => {
    const path = `${directory}/follow.log`;
    const marker = `follow-${fixture!.sandbox.data.id}`;
    const controller = new AbortController();

    await operation('create followed file', () => fixture!.sandbox.files.write(path, 'follow-ready\n'));
    const reader = fixture!.sandbox.files.follow(path, { lines: 1, signal: controller.signal }).getReader();
    const initial = await operation('start following file', () => reader.read());
    expect(new TextDecoder().decode(initial.value)).toContain('follow-ready');
    await operation('append followed file', () => fixture!.sandbox.exec([
      'php',
      '-r',
      `file_put_contents(${JSON.stringify(path)}, ${JSON.stringify(marker)}, FILE_APPEND);`,
    ]));

    const chunk = await operation('read appended content', () => reader.read());
    expect(chunk.done).toBe(false);
    expect(new TextDecoder().decode(chunk.value)).toContain(marker);

    controller.abort();
    await reader.cancel().catch(() => undefined);
  });
});
