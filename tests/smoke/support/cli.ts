import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import type { SandboxFixture } from './resources.js';

export function hasCliSmokeBinary(): boolean {
  return Boolean(process.env.PHPSANDBOX_SMOKE_CLI_BINARY);
}

export interface CliSmoke {
  readonly root: string;
  run(args: string[], input?: string, expectedCode?: number, timeout?: number): Promise<unknown>;
  lines(args: string[]): Promise<unknown[]>;
}

export async function createCliSmoke(fixture: SandboxFixture): Promise<CliSmoke> {
  const binary = z
    .string()
    .min(1, 'Set PHPSANDBOX_SMOKE_CLI_BINARY to a compiled CLI.')
    .parse(process.env.PHPSANDBOX_SMOKE_CLI_BINARY);
  const root = await mkdtemp(join(tmpdir(), 'phpsandbox-sdk-cli-'));
  const config = join(root, 'config');
  const home = join(root, 'home');
  await Promise.all([mkdir(config), mkdir(home)]);
  fixture.resources.register('CLI workspace and created notebooks', async () => {
    try {
      let state: string;
      try {
        state = await readFile(join(config, 'state.json'), 'utf8');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
        throw error;
      }
      const notebooks = z
        .object({ sandboxes: z.array(z.object({ id: z.string() })) })
        .parse(JSON.parse(state)).sandboxes;
      for (const notebook of notebooks) {
        const instance = await fixture.client.notebook.get(notebook.id);
        try {
          await instance.destroy();
        } finally {
          instance.dispose();
        }
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
  async function execute(
    args: string[],
    input: string | undefined,
    expectedCode: number,
    timeout: number,
  ): Promise<string> {
    const defaults = args.includes('--sandbox')
      ? ['--json']
      : ['--sandbox', fixture.sandbox.data.id, '--json'];
    const separator = args.indexOf('--');
    const command =
      separator < 0
        ? [...args, ...defaults]
        : [...args.slice(0, separator), ...defaults, ...args.slice(separator)];
    const child = spawn(binary, command, {
      cwd: root,
      env: {
        ...process.env,
        PATH: '',
        HOME: home,
        USERPROFILE: home,
        PHPSANDBOX_CONFIG_DIR: config,
        PHPSANDBOX_API_URL: fixture.environment.apiUrl,
        PHPSANDBOX_TOKEN: fixture.environment.token,
        NO_COLOR: '1',
        TERM: 'dumb',
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let expired = false;
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
    });
    child.stdin.end(input);
    const timer = setTimeout(() => {
      expired = true;
      child.kill('SIGKILL');
    }, timeout);
    try {
      const code = await new Promise<number | null>((resolve, reject) => {
        child.once('error', reject);
        child.once('close', resolve);
      });
      if (expired) throw new Error(`CLI ${args.slice(0, 2).join(' ')} exceeded ${timeout}ms.`);
      if (code !== expectedCode)
        throw new Error(`CLI ${args.slice(0, 2).join(' ')} exited ${code}: ${stdout}${stderr}`);
      return stdout;
    } finally {
      clearTimeout(timer);
    }
  }
  return {
    root,
    async run(args, input, expectedCode = 0, timeout = 180000): Promise<unknown> {
      return JSON.parse(await execute(args, input, expectedCode, timeout)) as unknown;
    },
    async lines(args): Promise<unknown[]> {
      return (await execute(args, undefined, 0, 60000))
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((line): unknown => JSON.parse(line));
    },
  };
}
