import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import type { SandboxFixture } from '../support/resources.js';
import { createSandboxFixture, operation } from '../support/resources.js';

describe.sequential('production SDK canary', () => {
  let fixture: SandboxFixture | undefined;

  beforeAll(async () => {
    fixture = await createSandboxFixture('canary');
  });

  afterAll(async () => {
    await fixture?.resources.cleanup();
  });

  test('selects the requested runtime transport', () => {
    const expected = fixture!.environment.transport === 'http' ? 'rest' : 'realtime';

    expect(fixture!.sandbox.runtimeTransport).toBe(expected);
  });

  test('lists owned notebook metadata through the public API', async () => {
    const page = await operation('list notebooks', () => fixture!.client.notebook.list({ page: 1, perPage: 100 }));
    const listed = page.data.find((notebook) => notebook.id === fixture!.sandbox.data.id);
    expect(listed).toMatchObject({ id: fixture!.sandbox.data.id, visibility: 'private' });
    expect(listed).not.toHaveProperty('runtimeUrl');
    expect(listed).not.toHaveProperty('gitUrl');
    expect(page.meta).toMatchObject({ current_page: 1, per_page: 100 });
  });

  test('initializes a valid runtime', () => {
    const initialized = fixture!.sandbox.initialized;

    expect(initialized).not.toBe(false);
    expect(initialized).toMatchObject({ type: 'success' });
    if (initialized !== false && initialized.type === 'success') {
      expect(initialized.data.env).toBeInstanceOf(Array);
      expect(() => new URL(initialized.data.previewUrl)).not.toThrow();
    }
  });

  test('connects the realtime transport', async () => {
    if (fixture!.environment.transport !== 'realtime') {
      return;
    }

    await operation('connect realtime transport', () => fixture!.sandbox.connected());
  });

  test('round-trips exact file contents', async () => {
    const path = `.phpsandbox-sdk-${fixture!.environment.transport}-smoke.txt`;
    const marker = `phpsandbox-sdk-smoke:${fixture!.environment.transport}:${fixture!.sandbox.data.id}\n`;

    await operation('write canary file', () => fixture!.sandbox.files.write(path, marker));
    await expect(operation('read canary file', () => fixture!.sandbox.files.readText(path))).resolves.toBe(marker);
  });

  test('executes PHP with exact output', async () => {
    const result = await operation('execute PHP', () => (
      fixture!.sandbox.exec(['php', '-r', 'echo "phpsandbox-sdk-smoke-ok\\n";'])
    ));

    expect(result).toMatchObject({
      exitCode: 0,
      stderr: '',
      stdout: 'phpsandbox-sdk-smoke-ok\n',
    });
  });
});
