import {
  PHPSandbox,
  type CreateNotebookInput,
  type NotebookData,
  type NotebookInstance,
  type PHPSandboxClientOptions,
} from '@phpsandbox/sdk';
import { readSmokeEnvironment, type SmokeEnvironment } from './environment.js';

const OPERATION_TIMEOUT_MS = 120_000;
const INITIALIZATION_TIMEOUT_MS = 300_000;
const PLACEMENT_RETRY_DELAY_MS = 20_000;
const PLACEMENT_ATTEMPTS = 4;

interface CleanupEntry {
  readonly cleanup: () => Promise<void>;
  readonly name: string;
  active: boolean;
}

export interface CleanupHandle {
  complete(): void;
}

export class SmokeOperationError extends Error {
  public constructor(
    public readonly operation: string,
    detail: string,
  ) {
    super(`${operation}: ${detail}`);
    this.name = 'SmokeOperationError';
  }
}

export class ResourceRegistry {
  readonly #entries: CleanupEntry[] = [];

  public register(name: string, cleanup: () => Promise<void>): CleanupHandle {
    const entry: CleanupEntry = { active: true, cleanup, name };
    this.#entries.push(entry);

    return {
      complete: () => {
        entry.active = false;
      },
    };
  }

  public async cleanup(): Promise<void> {
    const failures: Error[] = [];

    for (const entry of [...this.#entries].reverse()) {
      if (!entry.active) {
        continue;
      }

      try {
        await operation(`cleanup ${entry.name}`, entry.cleanup, OPERATION_TIMEOUT_MS);
        entry.active = false;
      } catch (error) {
        failures.push(error instanceof Error ? error : new Error(String(error)));
      }
    }

    if (failures.length > 0) {
      throw new AggregateError(failures, `Failed to clean up ${failures.length} smoke resource(s).`);
    }
  }
}

export interface SandboxFixture {
  readonly client: PHPSandbox;
  readonly environment: SmokeEnvironment;
  readonly resources: ResourceRegistry;
  readonly sandbox: NotebookInstance;
}

export async function createSandboxFixture(
  label: string,
  input: Pick<CreateNotebookInput, 'import'> = {},
): Promise<SandboxFixture> {
  const environment = readSmokeEnvironment();
  const resources = new ResourceRegistry();
  const client = createClient(environment);
  let sandbox: NotebookInstance | undefined;

  try {
    const createdSandbox = await operation('create sandbox', () => client.notebook.create('standard', {
      ...input,
      title: smokeTitle(environment, label),
      visibility: 'private',
    }));
    sandbox = createdSandbox;
    trackNotebook(resources, createdSandbox);

    sandbox = await initializeRuntime(client, createdSandbox);
    if (sandbox !== createdSandbox) {
      resources.register(`runtime connection ${sandbox.data.id}`, async () => sandbox?.dispose());
    }

    return { client, environment, resources, sandbox };
  } catch (error) {
    await resources.cleanup().catch(() => undefined);
    sandbox?.dispose();
    throw error;
  }
}

async function initializeRuntime(client: PHPSandbox, initialSandbox: NotebookInstance): Promise<NotebookInstance> {
  let sandbox = initialSandbox;

  for (let attempt = 1; attempt <= PLACEMENT_ATTEMPTS; attempt += 1) {
    try {
      await operation('initialize runtime', () => sandbox.ready(), INITIALIZATION_TIMEOUT_MS);
      return sandbox;
    } catch (error) {
      if (!isPlacementExhaustion(error) || attempt === PLACEMENT_ATTEMPTS) {
        throw error;
      }

      console.warn(
        `Runtime placement is temporarily exhausted; retrying in ${PLACEMENT_RETRY_DELAY_MS / 1_000}s `
        + `(${attempt + 1}/${PLACEMENT_ATTEMPTS}).`,
      );
      await delay(PLACEMENT_RETRY_DELAY_MS);
      sandbox.dispose();
      sandbox = await operation('refresh sandbox after placement exhaustion', () => client.notebook.get(sandbox.data.id));
    }
  }

  throw new Error('Runtime initialization attempts were exhausted.');
}

function isPlacementExhaustion(error: unknown): boolean {
  return error instanceof Error && error.message.includes('No eligible runner hosts');
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export function trackNotebook(resources: ResourceRegistry, notebook: NotebookInstance): CleanupHandle {
  return resources.register(`sandbox ${notebook.data.id}`, async () => {
    try {
      await notebook.destroy();
    } finally {
      notebook.dispose();
    }
  });
}

export async function createTrackedNotebook(
  fixture: SandboxFixture,
  create: () => Promise<NotebookInstance>,
): Promise<{ cleanup: CleanupHandle; notebook: NotebookInstance }> {
  const notebook = await operation('create tracked sandbox', create);
  const cleanup = trackNotebook(fixture.resources, notebook);

  return { cleanup, notebook };
}

export async function operation<T>(
  name: string,
  callback: () => Promise<T>,
  timeoutMs = OPERATION_TIMEOUT_MS,
): Promise<T> {
  let timeout: NodeJS.Timeout | undefined;
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => {
      reject(new Error(`timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });

  try {
    return await Promise.race([callback(), timeoutPromise]);
  } catch (error) {
    throw new SmokeOperationError(name, sanitize(formatError(error)));
  } finally {
    clearTimeout(timeout);
  }
}

function createClient(environment: SmokeEnvironment): PHPSandbox {
  const coreClient = PHPSandbox.realtime(environment.token, environment.apiUrl);
  const options: PHPSandboxClientOptions = {
    runtimeUrlProvider: async (notebookId: string): Promise<string> => {
      const notebook = await coreClient.notebook.get(notebookId);
      const runtimeUrl = notebook.data.runtimeUrl;
      notebook.dispose();

      return runtimeUrl;
    },
  };

  if (environment.transport === 'http') {
    return PHPSandbox.rest(environment.token, environment.apiUrl, options);
  }

  return PHPSandbox.realtime(environment.token, environment.apiUrl, options);
}

function smokeTitle(environment: SmokeEnvironment, label: string): CreateNotebookInput['title'] {
  return `SDK ${label} ${environment.transport} smoke ${environment.runId}`;
}

function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.stack ?? `${error.name}: ${error.message}`;
  }

  return String(error);
}

function sanitize(value: string): string {
  return value
    .replace(/(authorization:\s*bearer\s+)[^\s]+/gi, '$1[REDACTED]')
    .replace(/(--token(?:=|\s+))[^\s]+/gi, '$1[REDACTED]')
    .replace(/([?&](?:auth|ticket|token)=)[^&\s]+/gi, '$1[REDACTED]');
}
