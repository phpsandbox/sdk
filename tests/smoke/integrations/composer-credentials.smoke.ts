import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import type { CleanupHandle, SandboxFixture } from '../support/resources.js';
import { createSandboxFixture, operation, processResultDiagnostics } from '../support/resources.js';
import {
  readComposerCredentialSmokeEnvironment,
  type ComposerCredentialSmokeEnvironment,
} from '../support/environment.js';

const packageName = 'phpsandbox/sdk-smoke-private';
const packageVersion = '1.0.0';
const packageMarker = 'phpsandbox-sdk-private-composer-fixture-v1';

describe.sequential('production Composer credential contract', () => {
  let environment: ComposerCredentialSmokeEnvironment | undefined;
  let fixture: SandboxFixture | undefined;
  let credentialCleanup: CleanupHandle | undefined;
  let rootDirectory: string | undefined;

  beforeAll(async () => {
    environment = readComposerCredentialSmokeEnvironment();
    fixture = await createSandboxFixture('composer-credentials');
    rootDirectory = `.sdk-smoke-private-composer-${fixture.sandbox.data.id}`;
    await operation('create private Composer smoke projects', async () => {
      for (const project of ['without-credential', 'with-credential', 'after-removal']) {
        const projectDirectory = `${rootDirectory}/${project}`;
        await fixture!.sandbox.files.createDirectory(projectDirectory);
        await fixture!.sandbox.files.write(
          `${projectDirectory}/composer.json`,
          composerProject(environment!.repository),
        );
      }
    });
    fixture.resources.register(`private Composer fixture ${rootDirectory}`, () => (
      fixture!.sandbox.files.remove(rootDirectory!, { recursive: true })
    ));
  });

  afterAll(async () => {
    await fixture?.resources.cleanup();
  });

  test('rejects the private package without Composer credentials', async () => {
    const result = await requirePrivatePackage('without-credential');

    expect(result.exitCode).not.toBe(0);
    expect(result.output).not.toContain(environment!.github.token);
  });

  test('stores GitHub OAuth credentials without disclosing the token', async () => {
    const credential = await operation('store Composer GitHub OAuth credential', () => (
      fixture!.sandbox.composer.credentials.set({
        token: environment!.github.token,
        type: 'github-oauth',
      })
    ));
    credentialCleanup = fixture!.resources.register('Composer GitHub OAuth credential', () => (
      fixture!.sandbox.composer.credentials.remove('github-oauth')
    ));

    expect(credential).toEqual({ type: 'github-oauth', url: 'github.com' });
    expect(JSON.stringify(credential)).not.toContain(environment!.github.token);
    await operation(
      'restart runtime with Composer credential',
      () => fixture!.sandbox.restart(),
      180_000,
    );
  });

  test('installs and executes the authenticated private package', async () => {
    const result = await requirePrivatePackage('with-credential');

    expect(result.exitCode, processResultDiagnostics(result)).toBe(0);
    expect(result.output).toContain(packageName);
    expect(result.output).not.toContain(environment!.github.token);
    await expect(operation('execute private Composer package marker', () => fixture!.sandbox.exec([
      'php',
      '-r',
      `require '${rootDirectory}/with-credential/vendor/autoload.php'; echo PHPSandbox\\SmokeFixture\\Marker::value();`,
    ]))).resolves.toMatchObject({ exitCode: 0, stdout: packageMarker });
  });

  test('removes the Composer credential', async () => {
    await operation('remove Composer GitHub OAuth credential', () => (
      fixture!.sandbox.composer.credentials.remove('github-oauth')
    ));
    credentialCleanup?.complete();
    await operation(
      'restart runtime without Composer credential',
      () => fixture!.sandbox.restart(),
      180_000,
    );
  });

  test('rejects the private package again after credential removal', async () => {
    const result = await requirePrivatePackage('after-removal');

    expect(result.exitCode).not.toBe(0);
    expect(result.output).not.toContain(environment!.github.token);
  });

  async function requirePrivatePackage(project: string) {
    const process = fixture!.sandbox.composer.run('require', {
      packages: [`${packageName}:${packageVersion}`],
    }, {
      'no-cache': true,
      'no-interaction': true,
      'no-progress': true,
      'prefer-dist': true,
      'working-dir': `${rootDirectory}/${project}`,
    });

    return operation(`require private Composer package in ${project}`, () => process.wait());
  }
});

function composerProject(repository: string): string {
  return `${JSON.stringify({
    name: 'phpsandbox/sdk-private-composer-smoke',
    repositories: [
      { type: 'vcs', url: `https://github.com/${repository}` },
      { 'packagist.org': false },
    ],
    require: {},
  }, null, 2)}\n`;
}
