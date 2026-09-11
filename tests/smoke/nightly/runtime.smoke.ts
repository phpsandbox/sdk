import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import type { SandboxFixture } from '../support/resources.js';
import { createSandboxFixture, operation } from '../support/resources.js';

const supportedPhpVersions = ['8.2', '8.3', '8.4'] as const;

type SupportedPhpVersion = (typeof supportedPhpVersions)[number];

describe.sequential('production runtime inspection contract', () => {
  let fixture: SandboxFixture | undefined;

  beforeAll(async () => {
    fixture = await createSandboxFixture('runtime');
  });

  afterAll(async () => {
    await fixture?.resources.cleanup();
  });

  test('reports current metrics', async () => {
    const metrics = await operation('read current metrics', () => fixture!.sandbox.runtime.metrics.current());

    expect(metrics === null || typeof metrics === 'object').toBe(true);
  });

  test('lists ports and services', async () => {
    const ports = await operation('list opened ports', () => fixture!.sandbox.runtime.ports.list());
    const services = await operation('list services', () => fixture!.sandbox.services.list());

    expect(ports).toBeInstanceOf(Array);
    expect(services).toBeInstanceOf(Array);
  });

  test('reads project configuration', async () => {
    await expect(operation('read project configuration', () => fixture!.sandbox.config.get()))
      .resolves.toBeTypeOf('object');
  });

  test('updates project configuration and restores port mappings', async () => {
    const original = await operation('read original project configuration', () => fixture!.sandbox.config.get());
    const ports = [{ localPort: 39_001, externalPort: 39_001, primary: false }];
    const configDirectory = '.phpsandbox';
    const configPath = `${configDirectory}/setup.json`;

    if (!await fixture!.sandbox.files.exists(configDirectory)) {
      await operation('create project configuration directory', () => fixture!.sandbox.files.createDirectory(configDirectory));
    }
    if (!await fixture!.sandbox.files.exists(configPath)) {
      await operation('create project configuration file', () => fixture!.sandbox.files.write(
        configPath,
        `${JSON.stringify(original, null, 2)}\n`,
      ));
    }

    try {
      const updated = await operation('update project configuration', () => fixture!.sandbox.config.update({
        ...original,
        smokeMarker: fixture!.sandbox.data.id,
      }));
      expect(updated.smokeMarker).toBe(fixture!.sandbox.data.id);

      const mapped = await operation('set project ports', () => fixture!.sandbox.config.setPorts(ports));
      expect(mapped.ports).toEqual(expect.arrayContaining([expect.objectContaining({ localPort: 39_001 })]));
    } finally {
      await operation('restore project configuration', () => fixture!.sandbox.config.update(original));
    }
  });

  test('inspects Composer packages and Git state', async () => {
    const packages = await operation('list Composer packages', () => fixture!.sandbox.composer.packages());
    const status = await operation('read Git status', () => fixture!.sandbox.git.status());

    expect(packages).toBeInstanceOf(Array);
    expect(status).toEqual(expect.objectContaining({
      clean: expect.any(Boolean),
      initialized: expect.any(Boolean),
    }));
  });

  test('runs and stops a deterministic managed service with logs', async () => {
    const name = `sdk-smoke-${fixture!.sandbox.data.id}`;
    let serviceName = name;
    const cleanup = fixture!.resources.register(`service ${name}`, async () => {
      await fixture!.sandbox.services.stop(serviceName);
    });

    const service = await operation('run managed service', () => fixture!.sandbox.services.run(
      name,
      ['sh', '-lc', 'while true; do echo sdk-service-ready; sleep 1; done'],
    ));
    serviceName = service.name;
    expect(serviceName).toContain(name);

    await vi.waitFor(async () => {
      const logs = await fixture!.sandbox.services.logs(serviceName, { tail: 20 });
      expect(logs).toContain('sdk-service-ready');
    }, { timeout: 30_000, interval: 500 });

    if (fixture!.environment.transport === 'realtime') {
      const logs = fixture!.sandbox.services.logs(serviceName, { follow: true, tail: 20 }).getReader();
      const chunk = await operation('follow managed service logs', () => logs.read());
      expect(chunk.value).toContain('sdk-service-ready');
      await logs.cancel();
    }

    const stopped = await operation('stop managed service', () => fixture!.sandbox.services.stop(serviceName));
    expect(stopped.running).toBe(false);
    cleanup.complete();
  });

  test('exercises local Git index, history, review, and restore operations', async () => {
    const path = `.sdk-smoke-git-${fixture!.sandbox.data.id}.txt`;
    const author = 'PHPSandbox SDK Smoke <sdk-smoke@phpsandbox.io>';

    await operation('initialize Git smoke repository', () => fixture!.sandbox.git.checkpoint(
      author,
      `Initialize SDK smoke ${fixture!.sandbox.data.id}`,
      'main',
      true,
    ));
    await operation('write Git smoke file', () => fixture!.sandbox.files.write(path, 'git-smoke-v1\n'));
    const untracked = await operation('review untracked Git file', () => fixture!.sandbox.git.review());
    expect(untracked.files.some((file) => file.path.endsWith(path))).toBe(true);

    const staged = await operation('stage Git smoke file', () => fixture!.sandbox.git.stage({ path }));
    expect(staged.files.some((file) => file.path.endsWith(path) && file.staged)).toBe(true);

    const unstaged = await operation('unstage Git smoke file', () => fixture!.sandbox.git.unstage({ path }));
    expect(unstaged.files.some((file) => file.path.endsWith(path) && file.unstaged)).toBe(true);

    await operation('stage Git smoke file again', () => fixture!.sandbox.git.stage({ path }));
    const checkpoint = await operation('create Git checkpoint', () => fixture!.sandbox.git.checkpoint(
      author,
      `SDK smoke ${fixture!.sandbox.data.id}`,
      'main',
      true,
    ));
    expect(checkpoint.ref).not.toBe('');

    const branch = `sdk-smoke-${fixture!.sandbox.data.id}`;
    await expect(operation('create and checkout Git branch', () => fixture!.sandbox.git.checkout(branch)))
      .resolves.toMatchObject({ branch, created: true });
    await expect(operation('return to main Git branch', () => fixture!.sandbox.git.checkout('main', false)))
      .resolves.toMatchObject({ branch: 'main', created: false });

    const log = await operation('read Git log', () => fixture!.sandbox.git.log('main'));
    expect(log.some((entry) => entry.message.includes('SDK smoke'))).toBe(true);

    await operation('modify Git smoke file', () => fixture!.sandbox.files.write(path, 'git-smoke-v2\n'));
    const review = await operation('review modified Git file', () => fixture!.sandbox.git.review());
    expect(review.patch).toContain('git-smoke-v2');

    await operation('revert modified Git file', () => fixture!.sandbox.git.revert({ path }));
    await expect(operation('read reverted Git file', () => fixture!.sandbox.files.readText(path)))
      .resolves.toBe('git-smoke-v1\n');
    await operation('restore Git checkpoint', () => fixture!.sandbox.git.restore(checkpoint.ref));

    const credentials = await operation('read Git credentials', () => fixture!.sandbox.git.credentials());
    expect(credentials.url).toBeTypeOf('string');
    expect(credentials.expiresAt).toBeTypeOf('string');
  });

  test('installs the lock file and generates Composer autoload files', async () => {
    const install = fixture!.sandbox.composer.run('install', {}, {
      'no-interaction': true,
      'no-progress': true,
      'prefer-dist': true,
    });
    const installed = await operation('install Composer lock file', () => install.wait());
    expect(installed.exitCode).toBe(0);

    const autoload = fixture!.sandbox.composer.run('dump-autoload', {}, { 'no-interaction': true });
    const result = await operation('dump Composer autoload', () => autoload.wait());

    expect(result.exitCode).toBe(0);
  });

  test('requires, updates, and removes a local Composer package', async () => {
    const directory = `.sdk-smoke-composer-${fixture!.sandbox.data.id}`;
    const projectDirectory = `${directory}/project`;
    const repositoryDirectory = `${directory}/repository`;
    const composerOptions = {
      'no-progress': true,
      'working-dir': projectDirectory,
    } as const;

    await operation('create Composer smoke directories', async () => {
      await fixture!.sandbox.files.createDirectory(projectDirectory);
      await fixture!.sandbox.files.createDirectory(`${repositoryDirectory}/src`);
    });
    fixture!.resources.register(`Composer fixture ${directory}`, () => (
      fixture!.sandbox.files.remove(directory, { recursive: true })
    ));

    await operation('write Composer smoke project', () => fixture!.sandbox.files.write(
      `${projectDirectory}/composer.json`,
      composerProject(repositoryDirectory),
    ));
    await writeComposerPackage(fixture!, repositoryDirectory, '1.0.0');

    const requiredProcess = fixture!.sandbox.composer.run('require', {
      packages: ['phpsandbox/sdk-smoke-package:*'],
    }, composerOptions);
    const required = await operation('require local Composer package', () => requiredProcess.wait());
    expect(required.exitCode).toBe(0);
    expect(required.output).toContain('phpsandbox/sdk-smoke-package');
    await expect(operation('execute Composer package autoload', () => fixture!.sandbox.exec([
      'php',
      '-r',
      `require '${projectDirectory}/vendor/autoload.php'; echo PHPSandbox\\SdkSmoke\\Marker::VERSION;`,
    ]))).resolves.toMatchObject({ exitCode: 0, stdout: '1.0.0' });

    await writeComposerPackage(fixture!, repositoryDirectory, '1.1.0');
    const updatedProcess = fixture!.sandbox.composer.run('update', {
      packages: ['phpsandbox/sdk-smoke-package'],
    }, composerOptions);
    const updated = await operation('update local Composer package', () => updatedProcess.wait());
    expect(updated.exitCode).toBe(0);
    await expect(operation('execute updated Composer package', () => fixture!.sandbox.exec([
      'php',
      '-r',
      `require '${projectDirectory}/vendor/autoload.php'; echo PHPSandbox\\SdkSmoke\\Marker::VERSION;`,
    ]))).resolves.toMatchObject({ exitCode: 0, stdout: '1.1.0' });

    const removedProcess = fixture!.sandbox.composer.run('remove', {
      packages: ['phpsandbox/sdk-smoke-package'],
    }, composerOptions);
    const removed = await operation('remove local Composer package', () => removedProcess.wait());
    expect(removed.exitCode).toBe(0);
    const composerJson = JSON.parse(await operation(
      'read mutated Composer project',
      () => fixture!.sandbox.files.readText(`${projectDirectory}/composer.json`),
    )) as { require?: Record<string, string> };
    expect(composerJson.require?.['phpsandbox/sdk-smoke-package']).toBeUndefined();
  });

  test.runIf(process.env.PHPSANDBOX_SMOKE_TRANSPORT === 'realtime')('cancels an active Composer mutation over realtime', async () => {
    const directory = `.sdk-smoke-composer-cancel-${fixture!.sandbox.data.id}`;
    const marker = `${directory}/ready`;

    await operation('create cancellable Composer project', async () => {
      await fixture!.sandbox.files.createDirectory(directory);
      await fixture!.sandbox.files.write(`${directory}/composer.json`, `${JSON.stringify({
        name: 'phpsandbox/sdk-smoke-cancellation',
        repositories: [{ 'packagist.org': false }],
        require: {},
        scripts: {
          'pre-update-cmd': `@php -r "file_put_contents('/var/www/${marker}', 'ready'); sleep(60);"`,
        },
      }, null, 2)}\n`);
    });
    fixture!.resources.register(`cancellable Composer fixture ${directory}`, () => (
      fixture!.sandbox.files.remove(directory, { recursive: true })
    ));

    const process = fixture!.sandbox.composer.run('update', { packages: [] }, {
      'no-progress': true,
      'working-dir': directory,
    });
    await vi.waitFor(async () => {
      await expect(fixture!.sandbox.files.exists(marker)).resolves.toBe(true);
    }, { timeout: 30_000, interval: 250 });
    await operation('kill active Composer mutation', () => process.kill());
    const result = await operation('wait for cancelled Composer mutation', () => process.wait());

    expect(result.exitCode).not.toBe(0);
  });

  test('preserves stdout, stderr, arguments, and exit code', async () => {
    const result = await operation('execute diagnostic PHP', () => fixture!.sandbox.exec([
      'php',
      '-r',
      'fwrite(STDOUT, $argv[1]); fwrite(STDERR, $argv[2]); exit(7);',
      'stdout-value',
      'stderr-value',
    ]));

    expect(result).toMatchObject({
      exitCode: 7,
      stderr: 'stderr-value',
      stdout: 'stdout-value',
    });
  });

  test('switches across supported PHP versions and restores the original', async () => {
    const originalVersion = await currentPhpVersion(fixture!);
    if (!isSupportedPhpVersion(originalVersion)) {
      throw new TypeError(`Unsupported original PHP version: ${originalVersion}`);
    }

    try {
      for (const version of supportedPhpVersions) {
        const selected = await operation(`select PHP ${version}`, () => fixture!.sandbox.runtime.setPhpVersion(version));
        expect(selected).toEqual({ version });
        await expectPhpVersion(fixture!, version);
      }
    } finally {
      await operation(`restore PHP ${originalVersion}`, () => fixture!.sandbox.runtime.setPhpVersion(originalVersion));
      await expectPhpVersion(fixture!, originalVersion);
    }
  });

  test('restarts the runtime with successful recovery', async () => {
    await operation('restart runtime container', () => fixture!.sandbox.restart(), 180_000);
    await expect(operation('execute after restart', () => fixture!.sandbox.exec(['php', '-r', 'echo "restarted";'])))
      .resolves.toMatchObject({ exitCode: 0, stdout: 'restarted' });
  });

  test('stops and restarts the runtime with successful recovery', async () => {
    try {
      await operation('stop runtime container', () => fixture!.sandbox.stop());
    } finally {
      await operation('restart runtime container', () => fixture!.sandbox.restart(), 180_000);
    }
    await expect(operation('execute after stop and restart', () => fixture!.sandbox.exec(['php', '-r', 'echo "recovered";'])))
      .resolves.toMatchObject({ exitCode: 0, stdout: 'recovered' });
  });
});

async function currentPhpVersion(fixture: SandboxFixture): Promise<string> {
  const result = await operation('read current PHP version', () => fixture.sandbox.exec([
    'php',
    '-r',
    'echo PHP_MAJOR_VERSION.".".PHP_MINOR_VERSION;',
  ]));

  expect(result.exitCode).toBe(0);

  return result.stdout;
}

function isSupportedPhpVersion(version: string): version is SupportedPhpVersion {
  return supportedPhpVersions.some((supportedVersion) => supportedVersion === version);
}

async function expectPhpVersion(fixture: SandboxFixture, expectedVersion: SupportedPhpVersion): Promise<void> {
  await vi.waitFor(async () => {
    await expect(currentPhpVersion(fixture)).resolves.toBe(expectedVersion);
  }, { timeout: 15_000, interval: 250 });
}

function composerProject(repositoryDirectory: string): string {
  return `${JSON.stringify({
    name: 'phpsandbox/sdk-smoke-project',
    repositories: [
      { type: 'path', url: `/var/www/${repositoryDirectory}`, options: { symlink: false } },
      { 'packagist.org': false },
    ],
    require: {},
  }, null, 2)}\n`;
}

async function writeComposerPackage(
  fixture: SandboxFixture,
  repositoryDirectory: string,
  version: string,
): Promise<void> {
  await operation(`write Composer package ${version}`, async () => {
    await fixture.sandbox.files.write(`${repositoryDirectory}/composer.json`, `${JSON.stringify({
      name: 'phpsandbox/sdk-smoke-package',
      version,
      autoload: { 'psr-4': { 'PHPSandbox\\SdkSmoke\\': 'src/' } },
    }, null, 2)}\n`);
    await fixture.sandbox.files.write(
      `${repositoryDirectory}/src/Marker.php`,
      `<?php\n\nnamespace PHPSandbox\\SdkSmoke;\n\nfinal class Marker\n{\n    public const VERSION = '${version}';\n}\n`,
    );
  });
}
