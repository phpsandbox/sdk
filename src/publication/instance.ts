import type { Client } from '../index.js';
import { PublicationEventDataSchema, PublicationLogChunkDataSchema } from '../schemas/publications.js';
import type { PublicationEventData, PublicationLogChunkData, PublicationStatus } from '../schemas/publications.js';

import type {
  PublicationProtectionData,
  LaravelCloudSetupInput,
  PublicationProviderName,
  PublicationData,
  UpdatePublicationProtectionInput,
  PublicationProtectionSessionData,
  PublicationDestroyOptions,
} from './types.js';

import { PHPSandboxError, TransportError } from '../errors/index.js';
import { PublicationRun } from './run.js';
import { PublicationResources } from './resources.js';
import { PublicationDomains } from './domains.js';

export class PublicationApi {
  public readonly resources: PublicationResources;

  public constructor(private readonly client: Client) {
    this.resources = new PublicationResources(client);
  }

  public async get<TProvider extends PublicationProviderName = PublicationProviderName>(
    id: string
  ): Promise<PublicationInstance<TProvider>> {
    const response = await this.client.get<PublicationData<TProvider>>(`/publications/${encodeURIComponent(id)}`);

    return new PublicationInstance(response.data, this.client);
  }
}

export class PublicationInstance<TProvider extends PublicationProviderName = PublicationProviderName> {
  public readonly domains: PublicationDomains;
  public constructor(
    public readonly data: PublicationData<TProvider>,
    private readonly client: Client,
    private readonly notebookId?: string
  ) {
    this.domains = new PublicationDomains(client, data.id);
  }

  public async reconcileLaravelCloudResource(resourceId: string): Promise<PublicationInstance<TProvider>> {
    const response = await this.client.post<PublicationData<TProvider>>(
      `/publications/${encodeURIComponent(this.data.id)}/laravel-cloud/reconcile`,
      { resourceId }
    );
    return new PublicationInstance(response.data, this.client, this.notebookId);
  }

  public async configureLaravelCloud(setup: LaravelCloudSetupInput): Promise<PublicationInstance<TProvider>> {
    const response = await this.client.put<PublicationData<TProvider>>(
      `/publications/${encodeURIComponent(this.data.id)}/laravel-cloud/setup`,
      { setup }
    );
    return new PublicationInstance(response.data, this.client, this.notebookId);
  }

  public async refresh(): Promise<PublicationInstance<TProvider>> {
    const response = await this.client.get<PublicationData<TProvider>>(`/publications/${encodeURIComponent(this.data.id)}`);

    return new PublicationInstance(response.data, this.client, this.notebookId);
  }

  /** Start or reattach to the current release stream without queuing another release. */
  public follow(): PublicationRun<TProvider> {
    return new PublicationRun(this, this.client).start();
  }

  public async publish(): Promise<PublicationRun<TProvider>> {
    if (!this.notebookId) {
      throw new PHPSandboxError('Publishing requires a notebook-scoped publication instance.');
    }

    const response = await this.client.post<PublicationData<TProvider>>(
      `/notebook/${encodeURIComponent(this.notebookId)}/publication`
    );
    const run = new PublicationRun(new PublicationInstance(response.data, this.client, this.notebookId), this.client);
    run.start();

    return run;
  }

  public async destroy(options: PublicationDestroyOptions = {}): Promise<void> {
    const query = options.deleteResources ? '?deleteResources=1' : '';
    await this.client.delete<{ message?: string }>(`/publications/${encodeURIComponent(this.data.id)}${query}`);
  }

  public async wait(options: { intervalMs?: number; timeoutMs?: number } = {}): Promise<PublicationInstance<TProvider>> {
    const intervalMs = options.intervalMs ?? 1000;
    const timeoutMs = options.timeoutMs ?? 300000;
    const startedAt = Date.now();
    let current: PublicationInstance<TProvider> = this;

    while (!publicationStatusIsTerminal(current.data.status)) {
      if (Date.now() - startedAt > timeoutMs) {
        throw new PHPSandboxError(`Timed out waiting for publication ${this.data.id}`);
      }

      await delay(intervalMs);
      current = await current.refresh();
    }

    return current;
  }

  public async events(): Promise<ReadableStream<PublicationEventData>> {
    return parseNdjsonStream(
      await this.client.stream(`/publications/${encodeURIComponent(this.data.id)}/events/stream`),
      PublicationEventDataSchema
    );
  }

  public buildLogs(buildId: string = this.data.latestBuild?.id ?? ''): Promise<ReadableStream<PublicationLogChunkData>> {
    if (buildId === '') {
      return Promise.reject(new PHPSandboxError('Publication has no latest build id'));
    }

    return this.client
      .stream(`/publications/${encodeURIComponent(this.data.id)}/builds/${encodeURIComponent(buildId)}/logs/stream`)
      .then((stream) => parseNdjsonStream(stream, PublicationLogChunkDataSchema));
  }

  public async logs(): Promise<ReadableStream<PublicationLogChunkData>> {
    return parseNdjsonStream(
      await this.client.stream(`/publications/${encodeURIComponent(this.data.id)}/logs/stream`),
      PublicationLogChunkDataSchema
    );
  }

  public async setProtection(input: UpdatePublicationProtectionInput): Promise<PublicationInstance<TProvider>> {
    const response = await this.client.put<PublicationData<TProvider>>(
      `/publications/${encodeURIComponent(this.data.id)}/protection`,
      input
    );

    return new PublicationInstance(response.data, this.client, this.notebookId);
  }

  public async protection(): Promise<PublicationProtectionData> {
    const response = await this.client.get<PublicationProtectionData>(
      `/publications/${encodeURIComponent(this.data.id)}/protection`
    );

    return response.data;
  }

  public async createProtectionSession(): Promise<PublicationProtectionSessionData> {
    const response = await this.client.post<PublicationProtectionSessionData>(
      `/publications/${encodeURIComponent(this.data.id)}/protection/session`
    );

    return response.data;
  }

  public async disableProtection(): Promise<PublicationInstance<TProvider>> {
    const response = await this.client.delete<PublicationData<TProvider>>(
      `/publications/${encodeURIComponent(this.data.id)}/protection`
    );

    if (!response.data) {
      throw new TransportError('Protection response has no publication data.', 'InvalidResponse');
    }
    return new PublicationInstance(response.data, this.client, this.notebookId);
  }
}

function publicationStatusIsTerminal(status: PublicationStatus): boolean {
  return ['healthy', 'failed', 'stopped', 'deleted', 'delete_failed'].includes(status);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface ParseSchema<T> {
  parse(input: unknown): T;
}

function parseNdjsonStream<T>(input: ReadableStream<Uint8Array>, schema: ParseSchema<T>): ReadableStream<T> {
  const decoder = new TextDecoder();
  let buffer = '';

  return input.pipeThrough(
    new TransformStream<Uint8Array, T>({
      transform(chunk, controller) {
        buffer += decoder.decode(chunk, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed !== '') {
            controller.enqueue(schema.parse(JSON.parse(trimmed)));
          }
        }
      },
      flush(controller) {
        buffer += decoder.decode();
        const trimmed = buffer.trim();
        if (trimmed !== '') {
          controller.enqueue(schema.parse(JSON.parse(trimmed)));
        }
      },
    })
  );
}
