import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { chromium, type Browser, type Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import type {} from '../support/beacon-browser.js';
import type { SandboxFixture } from '../support/resources.js';
import { createSandboxFixture, operation } from '../support/resources.js';

const pageMarker = 'phpsandbox-sdk-beacon-page-v1';
const eventMarker = 'phpsandbox-sdk-beacon-events-v1';
const apiMarker = 'phpsandbox-sdk-beacon-api-v1';

describe.sequential('production Beacon browser contract', () => {
  let fixture: SandboxFixture | undefined;
  let browser: Browser | undefined;
  let page: Page | undefined;
  let bundleDirectory: string | undefined;
  let previewUrl: string | undefined;

  beforeAll(async () => {
    fixture = await createSandboxFixture('beacon');
    previewUrl = runtimePreviewUrl(fixture);
    await operation('write deterministic Beacon preview fixture', async () => {
      await fixture!.sandbox.files.write('index.php', beaconPage(pageMarker));
      await fixture!.sandbox.files.write('sdk-beacon-api.php', beaconApi(apiMarker));
    });

    bundleDirectory = await mkdtemp(join(tmpdir(), 'phpsandbox-sdk-beacon-'));
    const bundlePath = join(bundleDirectory, 'beacon-smoke.js');
    await build({
      bundle: true,
      entryPoints: [fileURLToPath(new URL('../support/beacon-browser.ts', import.meta.url))],
      format: 'iife',
      outfile: bundlePath,
      platform: 'browser',
      target: 'es2022',
    });
    browser = await chromium.launch({ headless: true });
    page = await browser.newPage({ viewport: { height: 720, width: 1_024 } });
    await page.setContent('<!doctype html><html><body><main>PHPSandbox Beacon smoke controller</main></body></html>');
    await page.addScriptTag({ path: bundlePath });
  }, 360_000);

  afterAll(async () => {
    await page?.evaluate(() => window.phpsandboxBeaconSmoke.dispose()).catch(() => undefined);
    await page?.close().catch(() => undefined);
    await browser?.close().catch(() => undefined);
    if (bundleDirectory !== undefined) {
      await rm(bundleDirectory, { force: true, recursive: true });
    }
    await fixture?.resources.cleanup();
  }, 300_000);

  test('connects to the preview iframe and responds to ping', async () => {
    const result = await page!.evaluate((url) => window.phpsandboxBeaconSmoke.connect(url), previewUrl!);

    expect(result.isReady).toBe(true);
    await expect(page!.evaluate(() => window.phpsandboxBeaconSmoke.ping())).resolves.toBe(true);
  }, 60_000);

  test('inspects deterministic preview DOM', async () => {
    const result = await page!.evaluate(() => window.phpsandboxBeaconSmoke.inspect('#sdk-beacon-marker'));

    expect(result).toMatchObject({
      id: 'sdk-beacon-marker',
      success: true,
      tagName: 'main',
      textContent: pageMarker,
    });
  });

  test('executes code and captures console and error events', async () => {
    const result = await page!.evaluate((marker) => (
      window.phpsandboxBeaconSmoke.emitAndReadEvents(marker)
    ), eventMarker);

    expect(result.execution).toMatchObject({ result: eventMarker, success: true });
    expect(result.console.some((event) => event.args.includes(eventMarker))).toBe(true);
    expect(result.errors.some((event) => event.message === eventMarker)).toBe(true);
  });

  test('fetches a deterministic endpoint inside the preview', async () => {
    const result = await page!.evaluate((url) => window.phpsandboxBeaconSmoke.fetch(url), (
      withPath(previewUrl!, '/sdk-beacon-api.php')
    ));

    expect(result).toEqual({
      body: { marker: apiMarker },
      status: 200,
      success: true,
    });
  });

  test('captures a non-empty PNG screenshot', async () => {
    const result = await page!.evaluate(() => window.phpsandboxBeaconSmoke.captureScreenshot());

    expect(result).toMatchObject({ success: true, type: 'image/png' });
    expect(result.byteLength).toBeGreaterThan(100);
    expect(result.size).toBeGreaterThan(100);
  }, 60_000);

  test('navigates, reconnects, and reports the new URL', async () => {
    const target = withPath(previewUrl!, `/?sdk-beacon=${fixture!.environment.runId}`);
    const result = await page!.evaluate((url) => window.phpsandboxBeaconSmoke.navigate(url), target);

    expect(result.isReady).toBe(true);
    expect(result.eventUrl).toBe(target);
    expect(result.url).toBe(target);
    await expect(page!.evaluate(() => window.phpsandboxBeaconSmoke.ping())).resolves.toBe(true);
  }, 60_000);

  test('disposes the browser Beacon cleanly', async () => {
    await page!.evaluate(() => window.phpsandboxBeaconSmoke.dispose());
    expect(await page!.locator('#phpsandbox-beacon-smoke-frame').count()).toBe(0);
  });
});

function runtimePreviewUrl(fixture: SandboxFixture): string {
  const initialized = fixture.sandbox.initialized;
  if (initialized === false || initialized.type !== 'success') {
    throw new Error('Sandbox runtime is not initialized.');
  }

  return initialized.data.previewUrl;
}

function withPath(input: string, path: string): string {
  return new URL(path, input).toString();
}

function beaconPage(marker: string): string {
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>PHPSandbox Beacon smoke</title></head>
<body><main id="sdk-beacon-marker">${marker}</main></body>
</html>
`;
}

function beaconApi(marker: string): string {
  return `<?php

declare(strict_types=1);

header('Content-Type: application/json');
echo json_encode(['marker' => '${marker}'], JSON_THROW_ON_ERROR);
`;
}
