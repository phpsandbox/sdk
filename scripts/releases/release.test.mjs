import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { prepareEnvironment, publicationTag } from './release.mjs';

const cli = fileURLToPath(new URL('./release.mjs', import.meta.url));

function command(program, args, options = {}) {
  const result = spawnSync(program, args, { encoding: 'utf8', ...options });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

function fixture(t, failingStep = '') {
  const directory = mkdtempSync(join(tmpdir(), 'release test '));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const repo = join(directory, 'repository');
  const bin = join(directory, 'bin');
  const output = join(directory, 'prepared');
  const log = join(directory, 'calls.jsonl');
  mkdirSync(repo);
  mkdirSync(bin);
  writeFileSync(join(repo, 'package.json'), JSON.stringify({ name: '@phpsandbox/sdk', version: '0.0.0-test' }));
  writeFileSync(join(repo, 'source.txt'), 'committed\n');
  command('git', ['init', '--quiet', repo]);
  command('git', ['-C', repo, 'add', '.']);
  command('git', [
    '-C',
    repo,
    '-c',
    'user.name=Release Test',
    '-c',
    'commit.gpgsign=false',
    '-c',
    'core.hooksPath=/dev/null',
    '-c',
    'user.email=release@example.com',
    'commit',
    '--quiet',
    '-m',
    'fixture [skip ci]',
  ]);
  command('git', ['-C', repo, 'remote', 'add', 'origin', 'https://github.com/phpsandbox/sdk.git']);
  const revision = command('git', ['-C', repo, 'rev-parse', 'HEAD']);
  // Model the release runtime separately from the Node version running this test.
  writeFileSync(
    join(bin, 'node'),
    `#!/bin/sh
if [ "$1" = '-p' ]; then
  echo 24
  exit 0
fi
exec '${process.execPath}' "$@"
`,
    { mode: 0o755 }
  );
  // npm is simulated; Git checkout, archives and checksum verification are real.
  writeFileSync(
    join(bin, 'npm'),
    `#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const args = process.argv.slice(2);
if (args[0] === '--version') { console.log('11.0.0'); process.exit(0); }
fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify(args) + '\\n');
if (args.join(' ') === ${JSON.stringify(failingStep)}) { process.exit(19); }
if (args[0] === 'pack') {
  fs.writeFileSync(path.join(process.env.RELEASE_OUTPUT, 'phpsandbox-sdk-0.0.0-test.tgz'), 'checked package');
}
`,
    { mode: 0o755 }
  );
  const env = { ...process.env, PATH: `${bin}:${process.env.PATH}` };
  const invoke = (...args) => spawnSync(process.execPath, [cli, ...args], { env, encoding: 'utf8' });
  const prepare = () => invoke('prepare', 'sdk', '--repo', repo, '--ref', revision, '--tag', 'canary', '--out', output);
  const calls = () =>
    readFileSync(log, 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
  return { directory, repo, bin, output, log, revision, invoke, prepare, calls, env };
}

await test('preparation checks the committed snapshot and excludes dirty and untracked files', (t) => {
  const f = fixture(t);
  writeFileSync(join(f.repo, 'source.txt'), 'uncommitted\n');
  writeFileSync(join(f.repo, 'untracked-secret'), 'secret');

  const result = f.prepare();

  assert.equal(result.status, 0, result.stderr);
  const manifest = JSON.parse(readFileSync(join(f.output, 'manifest.json'), 'utf8'));
  assert.equal(manifest.revision, f.revision);
  assert.equal(manifest.version, '0.0.0-test');
  assert.equal(command('tar', ['-xOzf', join(f.output, 'release.tar.gz'), './source.txt']), 'committed');
  assert.doesNotMatch(command('tar', ['-tzf', join(f.output, 'release.tar.gz')]), /untracked-secret|\.git\//);
  assert.equal(readFileSync(join(f.repo, 'source.txt'), 'utf8'), 'uncommitted\n');
  assert.equal(existsSync(join(f.output, 'source')), false);
  assert.equal(existsSync(join(f.output, 'attempt.json')), false);
});

await test('failed builds never produce a releasable manifest or package', (t) => {
  const f = fixture(t, 'run build');

  const result = f.prepare();

  assert.equal(result.status, 1);
  assert.equal(existsSync(join(f.output, 'manifest.json')), false);
  assert.equal(existsSync(join(f.output, 'phpsandbox-sdk-0.0.0-test.tgz')), false);
});

await test('apply defaults to a verified plan with no publication or attempt', (t) => {
  const f = fixture(t);
  assert.equal(f.prepare().status, 0);
  const before = f.calls();

  const result = f.invoke('apply', f.output);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Plan only/);
  assert.deepEqual(f.calls(), before);
  assert.equal(existsSync(join(f.output, 'attempt.json')), false);
});

for (const artifact of ['release.tar.gz', 'phpsandbox-sdk-0.0.0-test.tgz']) {
  await test(`tampered ${artifact} fails before publication`, (t) => {
    const f = fixture(t);
    assert.equal(f.prepare().status, 0);
    const before = f.calls();
    appendFileSync(join(f.output, artifact), 'changed');

    const result = f.invoke('apply', f.output, '--execute');

    assert.equal(result.status, 1);
    assert.match(result.stderr, /checksum mismatch/);
    assert.deepEqual(f.calls(), before);
    assert.equal(existsSync(join(f.output, 'attempt.json')), false);
  });
}

await test('execute publishes only the checked npm tarball and records completion', (t) => {
  const f = fixture(t);
  f.env.RELEASE_NPM_TAG = 'latest';
  assert.equal(f.prepare().status, 0);

  const result = f.invoke('apply', f.output, '--execute');

  assert.equal(result.status, 0, result.stderr);
  const publications = f.calls().filter((args) => args[0] === 'publish');
  assert.equal(publications.length, 1);
  assert.equal(publications[0][1], join(f.output, 'phpsandbox-sdk-0.0.0-test.tgz'));
  assert.ok(publications[0].includes('--ignore-scripts'));
  assert.equal(publications[0][publications[0].indexOf('--tag') + 1], 'canary');
  const receipt = JSON.parse(readFileSync(join(f.output, 'completed.json'), 'utf8'));
  assert.equal(receipt.revision, f.revision);

  const duplicate = f.invoke('apply', f.output, '--execute');

  assert.equal(duplicate.status, 1);
  assert.equal(f.calls().filter((args) => args[0] === 'publish').length, 1);
});

await test('publication failure leaves an attempt without claiming completion', (t) => {
  const f = fixture(t, 'whoami --registry=https://registry.npmjs.org/');
  assert.equal(f.prepare().status, 0);

  const result = f.invoke('apply', f.output, '--execute');

  assert.equal(result.status, 1);
  assert.equal(existsSync(join(f.output, 'attempt.json')), true);
  assert.equal(existsSync(join(f.output, 'completed.json')), false);
  assert.equal(f.calls().filter((args) => args[0] === 'publish').length, 0);
});

await test('moving refs are rejected before checks', (t) => {
  const f = fixture(t);

  const result = f.invoke('prepare', 'sdk', '--repo', f.repo, '--ref', 'HEAD', '--out', f.output);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /40-character/);
  assert.equal(existsSync(f.output), false);
});

await test('apply rejects target and ref overrides', (t) => {
  const f = fixture(t);

  const result = f.invoke('apply', f.output, '--ref', f.revision, '--execute');

  assert.equal(result.status, 1);
  assert.match(result.stderr, /do not override/);
  assert.equal(existsSync(f.output), false);
});

await test('test subprocesses do not inherit production payment or database variables', () => {
  const env = prepareEnvironment('sdk', '/tmp/release', undefined, {
    PATH: process.env.PATH,
    DOT_ENV: 'production secrets',
    STRIPE_SECRET_KEY: 'production-key',
    DB_HOST: 'production.example.com',
  });

  assert.equal(env.DOT_ENV, undefined);
  assert.equal(env.STRIPE_SECRET_KEY, undefined);
  assert.equal(env.DB_HOST, undefined);
});

await test('changed release tooling invalidates an old preparation before publication', (t) => {
  const f = fixture(t);
  assert.equal(f.prepare().status, 0);
  const path = join(f.output, 'manifest.json');
  const manifest = JSON.parse(readFileSync(path, 'utf8'));
  manifest.toolsSha256 = '0'.repeat(64);
  writeFileSync(path, JSON.stringify(manifest));
  const before = f.calls();

  const result = f.invoke('apply', f.output, '--execute');

  assert.equal(result.status, 1);
  assert.match(result.stderr, /tooling changed/);
  assert.deepEqual(f.calls(), before);
  assert.equal(existsSync(join(f.output, 'attempt.json')), false);
});

await test('the standalone command derives its repository without a central checkout', (t) => {
  const f = fixture(t);
  const checkout = fileURLToPath(new URL('../../', import.meta.url));
  const revision = command('git', ['-C', checkout, 'rev-parse', 'HEAD']);

  const result = f.invoke('plan', 'sdk', '--ref', revision, '--tag', 'canary');

  assert.equal(result.status, 0, result.stderr);
  assert.ok(result.stdout.includes('"repository": "phpsandbox/sdk"'));
  assert.match(result.stdout, new RegExp(revision));
});

await test('the standalone command rejects another project component', (t) => {
  const f = fixture(t);

  const result = f.invoke('plan', 'another-project', '--repo', f.repo, '--ref', f.revision);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /Choose a component/);
});

test('stable releases can use latest', () => {
  assert.equal(publicationTag('0.6.0', 'latest'), 'latest');
});

test('prereleases cannot move latest', () => {
  assert.throws(() => publicationTag('0.6.0-canary.0', 'latest'), /Prerelease versions/);
});

test('unsupported publication tags are rejected', () => {
  assert.throws(() => publicationTag('0.6.0-canary.0', 'invalid'), /Choose --tag/);
});

test('apply cannot override the prepared publication tag', (t) => {
  const f = fixture(t);

  const result = f.invoke('apply', f.output, '--tag', 'latest', '--execute');

  assert.equal(result.status, 1);
  assert.match(result.stderr, /do not override/);
  assert.equal(existsSync(join(f.output, 'attempt.json')), false);
});

test('manifest metadata cannot relabel a prerelease as stable', (t) => {
  const f = fixture(t);
  assert.equal(f.prepare().status, 0);
  const path = join(f.output, 'manifest.json');
  const manifest = JSON.parse(readFileSync(path, 'utf8'));
  manifest.version = '0.0.0';
  manifest.tag = 'latest';
  writeFileSync(path, JSON.stringify(manifest));

  const result = f.invoke('apply', f.output, '--execute');

  assert.equal(result.status, 1);
  assert.match(result.stderr, /version differs/);
  assert.equal(f.calls().filter((args) => args[0] === 'publish').length, 0);
  assert.equal(existsSync(join(f.output, 'attempt.json')), false);
});
