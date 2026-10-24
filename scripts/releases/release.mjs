#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';

const tools = dirname(fileURLToPath(import.meta.url));
const repositories = {
  sdk: 'phpsandbox/sdk',
};
const repositoryRoot = resolve(tools, '../..');
const shaPattern = /^[a-f0-9]{40}$/;

export function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: 'inherit', ...options });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`${command} failed (${result.signal ?? result.status})`);
  }
  return result.stdout?.toString().trim() ?? '';
}

function capture(command, args, options = {}) {
  return run(command, args, { ...options, stdio: ['ignore', 'pipe', 'inherit'] });
}

function hash(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function toolsHash() {
  const digest = createHash('sha256');
  for (const name of ['release.mjs', 'components.sh']) {
    digest.update(name).update(readFileSync(join(tools, name)));
  }
  return digest.digest('hex');
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
}

// Do not let a caller's production database, mail or payment variables enter tests.
export function prepareEnvironment(component, output, arch, input = process.env) {
  const names = ['PATH', 'HOME', 'TMPDIR', 'LANG', 'LC_ALL', 'TERM', 'SSH_AUTH_SOCK', 'GIT_SSH_COMMAND', 'SSL_CERT_FILE'];
  const env = Object.fromEntries(names.filter((name) => input[name]).map((name) => [name, input[name]]));
  return { ...env, RELEASE_OUTPUT: output, RELEASE_ARCH: arch ?? '', RELEASE_TOOLS: tools };
}

function assertComponent(component) {
  if (!Object.hasOwn(repositories, component)) {
    throw new Error(`Choose a component: ${Object.keys(repositories).join(', ')}`);
  }
}

export function publicationTag(version, tag) {
  if (typeof version !== 'string' || version.length === 0) {
    throw new Error('A package version is required.');
  }
  if (!['latest', 'canary'].includes(tag)) {
    throw new Error('Choose --tag latest or --tag canary.');
  }
  if (version.includes('-') && tag === 'latest') {
    throw new Error('Prerelease versions must use --tag canary, not latest.');
  }
  return tag;
}

function repositoryPlan(component, options) {
  assertComponent(component);
  if (!shaPattern.test(options.ref ?? '')) {
    throw new Error('Supply an explicit full 40-character --ref commit.');
  }
  const repo = resolve(options.repo ?? repositoryRoot);
  const revision = capture('git', ['-C', repo, 'rev-parse', '--verify', `${options.ref}^{commit}`]);
  const remote = capture('git', ['-C', repo, 'remote', 'get-url', 'origin']);
  const expected = repositories[component];
  const remoteIdentity = remote.match(/^(?:https:\/\/github\.com\/|git@github\.com:)([^?#]+?)(?:\.git)?$/)?.[1];
  if (remoteIdentity !== expected) {
    throw new Error(`Expected repository ${expected}.`);
  }
  if (options.target) {
    throw new Error('This project does not accept --target.');
  }
  const { version } = JSON.parse(capture('git', ['-C', repo, 'show', `${revision}:package.json`]));
  const tag = publicationTag(version, options.tag ?? 'latest');
  return { component, repository: expected, revision, version, tag };
}

function describe(plan) {
  console.log(JSON.stringify(plan, null, 2));
  console.log(
    `\nPrepare/check/build recipe:\n${readFileSync(join(tools, 'components.sh'), 'utf8').split(`  ${plan.component}:prepare)`)[1].split('    ;;')[0].trim()}`
  );
}

export function prepare(component, options) {
  const plan = repositoryPlan(component, options);
  if (!options.out) {
    throw new Error('Supply a new --out directory for the release artifact.');
  }
  const output = resolve(options.out);
  const env = prepareEnvironment(component, output, undefined);
  mkdirSync(output, { mode: 0o700 });
  const source = join(output, 'source');
  console.log(`Preparing ${plan.repository}@${plan.revision} in ${source}`);
  run('git', ['clone', '--quiet', '--no-hardlinks', '--no-checkout', resolve(options.repo ?? repositoryRoot), source], { env });
  run('git', ['checkout', '--quiet', '--detach', plan.revision], { cwd: source, env });
  // Restore the canonical origin so relative submodule URLs resolve correctly.
  run('git', ['remote', 'set-url', 'origin', `https://github.com/${plan.repository}.git`], { cwd: source, env });
  run('git', ['submodule', 'update', '--init', '--recursive'], { cwd: source, env });
  run('bash', [join(tools, 'components.sh'), component, 'prepare'], { cwd: source, env });

  writeFileSync(join(source, 'RELEASE_REVISION'), `${plan.revision}\n`);
  const artifact = 'release.tar.gz';
  run('tar', [
    '--exclude=.git',
    '--exclude=node_modules',
    '--exclude=.env',
    '--exclude=.env.keys',
    '--exclude=auth.json',
    '--exclude=tmp',
    '--exclude=.wrangler',
    '--exclude=storage/oauth-private.key',
    '--exclude=storage/oauth-public.key',
    '--exclude=storage/logs',
    '-czf',
    join(output, artifact),
    '-C',
    source,
    '.',
  ]);
  const manifest = {
    schema: 1,
    ...plan,
    preparedAt: new Date().toISOString(),
    toolsSha256: toolsHash(),
    artifact,
    artifactSha256: hash(join(output, artifact)),
  };
  if (component === 'sdk') {
    const packageName = readdirSync(output).filter((name) => name.endsWith('.tgz'));
    if (packageName.length !== 1) {
      throw new Error('Expected exactly one npm package tarball.');
    }
    manifest.package = packageName[0];
    manifest.packageSha256 = hash(join(output, manifest.package));
  }
  writeJson(join(output, 'manifest.json'), manifest);
  rmSync(source, { recursive: true });
  console.log(`Prepared ${join(output, 'manifest.json')}. No deployment or publishing performed.`);
  return manifest;
}

export function readManifest(directory) {
  const manifest = JSON.parse(readFileSync(join(directory, 'manifest.json'), 'utf8'));
  assertComponent(manifest.component);
  if (
    manifest.schema !== 1 ||
    !shaPattern.test(manifest.revision ?? '') ||
    manifest.repository !== repositories[manifest.component] ||
    manifest.artifact !== 'release.tar.gz'
  ) {
    throw new Error('Invalid release manifest.');
  }
  if (manifest.toolsSha256 !== toolsHash()) {
    throw new Error('Release tooling changed since preparation; prepare again with this version.');
  }
  if (hash(join(directory, manifest.artifact)) !== manifest.artifactSha256) {
    throw new Error('Release archive checksum mismatch.');
  }
  if (manifest.component === 'sdk') {
    publicationTag(manifest.version, manifest.tag);
    if (
      typeof manifest.package !== 'string' ||
      basename(manifest.package) !== manifest.package ||
      !manifest.package.endsWith('.tgz') ||
      hash(join(directory, manifest.package)) !== manifest.packageSha256
    ) {
      throw new Error('npm package checksum mismatch.');
    }
  }
  return manifest;
}

function applicationEnvironment(manifest, directory, source, id) {
  const env = {
    ...process.env,
    RELEASE_TOOLS: tools,
    RELEASE_COMMIT: manifest.revision,
    RELEASE_ID: id,
  };
  if (manifest.component === 'sdk') {
    const { version } = JSON.parse(readFileSync(join(source, 'package.json'), 'utf8'));
    if (version !== manifest.version) {
      throw new Error('Package version differs from the prepared manifest.');
    }
    publicationTag(version, manifest.tag);
    env.RELEASE_PACKAGE = join(directory, manifest.package);
    env.RELEASE_NPM_TAG = manifest.tag;
  }
  return env;
}

export function apply(directory, execute) {
  directory = resolve(directory);
  const manifest = readManifest(directory);
  describe(manifest);
  console.log(
    `\nDeploy/publish recipe:\n${readFileSync(join(tools, 'components.sh'), 'utf8').split(`  ${manifest.component}:apply)`)[1].split('    ;;')[0].trim()}`
  );
  if (!execute) {
    console.log('\nPlan only. Add --execute to deploy/publish this verified artifact.');
    return;
  }
  // A failed release must be inspected, not blindly retried. Prepare a new output
  // directory once external state (including possible npm publication) is known.
  const attempt = join(directory, 'attempt.json');
  const timestamp = new Date().toISOString();
  const date = timestamp.slice(0, 10).replaceAll('-', '');
  const time = timestamp.slice(11, 19).replaceAll(':', '');
  const id = `${date}_${time}_${timestamp.slice(20, 23)}-${manifest.revision.slice(0, 12)}`;
  const source = mkdtempSync(join(tmpdir(), 'manual-release-'));
  try {
    run('tar', ['-xzf', join(directory, manifest.artifact), '-C', source]);
    const env = applicationEnvironment(manifest, directory, source, id);
    writeJson(attempt, { id, component: manifest.component, revision: manifest.revision, startedAt: new Date().toISOString() });
    run('bash', [join(tools, 'components.sh'), manifest.component, 'apply'], { cwd: source, env });
    writeJson(join(directory, 'completed.json'), { id, revision: manifest.revision, completedAt: new Date().toISOString() });
  } finally {
    rmSync(source, { recursive: true, force: true });
  }
  console.log(`Release completed. Receipt: ${join(directory, 'completed.json')}`);
}

export function main(args) {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      repo: { type: 'string' },
      ref: { type: 'string' },
      out: { type: 'string' },
      target: { type: 'string' },
      tag: { type: 'string' },
      execute: { type: 'boolean', default: false },
      help: { type: 'boolean', default: false },
    },
  });
  const [action, subject] = positionals;
  if (values.help || !action) {
    console.log(
      'Usage:\n  node scripts/releases/release.mjs plan|prepare <sdk> --ref FULL_SHA [--tag latest|canary] [--repo PATH] [--out NEW_DIRECTORY]\n  node scripts/releases/release.mjs apply RELEASE_DIRECTORY [--execute]\n\nSee docs/manual-releases.md for credentials, checks and recovery.'
    );
    return;
  }
  if (positionals.length !== 2) {
    throw new Error('Expected an action and one component or release directory.');
  }
  if (action === 'plan') {
    describe(repositoryPlan(subject, values));
  } else if (action === 'prepare') {
    if (values.execute) {
      throw new Error('--execute applies only to apply.');
    }
    prepare(subject, values);
  } else if (action === 'apply') {
    if (values.repo || values.ref || values.out || values.target || values.tag) {
      throw new Error('Apply uses the manifest; do not override its inputs.');
    }
    apply(subject, values.execute);
  } else {
    throw new Error('Choose plan, prepare or apply.');
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Release failed.');
    process.exitCode = 1;
  }
}
