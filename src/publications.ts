import type { Client } from './index.js';
import {
  PublicationEventDataSchema,
  PublicationLogChunkDataSchema,
  PublishStreamSseEventNameSchema,
  PublishStreamSseEventSchema,
} from './schemas/publications.js';
import type {
  PublicationBuildStatus,
  PublicationEventData,
  PublicationJurisdiction,
  PublicationLogChunkData,
  PublicationLogStream,
  PublicationProtectionMode,
  PublicationRegion,
  PublicationReleaseStatus,
  PublicationSize,
  PublicationStatus,
  PublishStreamEvent,
  PublishStreamResult,
} from './schemas/publications.js';

export type {
  BuiltInPublicationProviderName,
  PublicationBuildStatus,
  PublicationEventData,
  PublicationJurisdiction,
  PublicationLogChunkData,
  PublicationLogStream,
  PublicationProtectionMode,
  PublicationRegion,
  PublicationReleaseStatus,
  PublicationSize,
  PublicationStatus,
  PublishStreamEvent,
  PublishStreamLog,
  PublishStreamPhase,
  PublishStreamResult,
  PublishStreamSseEvent,
} from './schemas/publications.js';

export interface PublicationPlacement {
  regions?: PublicationRegion[];
  jurisdiction?: PublicationJurisdiction;
}

export type LaravelCloudRegion =
  | 'us-east-2'
  | 'us-east-1'
  | 'ca-central-1'
  | 'eu-central-1'
  | 'eu-west-1'
  | 'eu-west-2'
  | 'me-central-1'
  | 'ap-southeast-1'
  | 'ap-southeast-2'
  | 'ap-northeast-1';

export interface PublicationProtectionData {
  mode: PublicationProtectionMode;
  enabled: boolean;
  token?: string;
  expiresAt?: string;
  url?: string;
}

export type PublicationProtectionInput =
  | {
    mode: 'none';
    password?: never;
  }
  | {
    mode: 'password';
    password: string;
  };

export interface CloudflareContainersProviderOptions {
  accountId: string;
  size?: PublicationSize;
  sleepAfter?: string;
  placement?: PublicationPlacement;
  instances?: number;
}

export interface SshServerProviderOptions {
  serverId: string;
}

export interface LaravelCloudProviderData {
  region?: LaravelCloudRegion;
  repository?: string;
  branch?: string;
  sourceControlProviderType?: 'github' | 'gitlab' | 'bitbucket';
}

export interface LaravelCloudProviderInput {
  region: LaravelCloudRegion;
}

export interface PublicationProviderInputs {
  'cloudflare-containers': CloudflareContainersProviderOptions;
  'ssh-server': SshServerProviderOptions;
  'laravel-cloud': LaravelCloudProviderInput;
}

export interface PublicationProviderData {
  'cloudflare-containers': CloudflareContainersProviderOptions;
  'ssh-server': SshServerProviderOptions;
  'laravel-cloud': LaravelCloudProviderData;
}

export type PublicationProviderName = Extract<keyof PublicationProviderInputs, string>;
export type PublicationProviderInput<TName extends PublicationProviderName = PublicationProviderName> = {
  [Name in TName]: { name: Name } & PublicationProviderInputs[Name]
}[TName];
export type PublicationProvider<TName extends PublicationProviderName = PublicationProviderName> = {
  [Name in TName]: { name: Name } & PublicationProviderData[Name]
}[TName];

export interface PublishInput<TName extends PublicationProviderName = PublicationProviderName> {
  slug: string;
  provider: PublicationProviderInput<TName>;
  protection?: PublicationProtectionInput;
  metadata?: Record<string, unknown>;
}

export interface PublicationBuildData<TProvider extends PublicationProviderName = PublicationProviderName> {
  id: string;
  status: PublicationBuildStatus;
  strategy: string;
  provider: PublicationProvider<TProvider>;
  errorMessage: string | null;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface PublicationReleaseData {
  id: string;
  status: PublicationReleaseStatus;
  manifest: Record<string, unknown>;
}

export interface PublicationData<TProvider extends PublicationProviderName = PublicationProviderName> {
  id: string;
  slug: string;
  url: string;
  status: PublicationStatus;
  strategy: string;
  provider: PublicationProvider<TProvider>;
  protection: PublicationProtectionData;
  eventStreamUrl: string | null;
  originUrl: string | null;
  currentRelease?: PublicationReleaseData | null;
  latestBuild?: PublicationBuildData<TProvider> | null;
  deployedAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface UpdatePublicationProtectionInput {
  mode: PublicationProtectionMode;
  password?: string;
}

export interface PublicationProtectionSessionData {
  previewSessionId: string;
  token: string;
  expiresAt: string;
  url: string;
}

export class PublicationApi {
  public constructor(private readonly client: Client) { }

  public async get<TProvider extends PublicationProviderName = PublicationProviderName>(
    id: string
  ): Promise<PublicationInstance<TProvider>> {
    const response = await this.client.get<PublicationData<TProvider>>(`/publications/${id}`);

    return new PublicationInstance(response.data, this.client);
  }

}

export class PublicationRun<TProvider extends PublicationProviderName = PublicationProviderName> {
  private started = false;
  private completed = false;
  private finalError: unknown = null;
  private finalResult: PublishStreamResult | null = null;
  private resultPromise: Promise<PublishStreamResult> | null = null;
  private resolveResult: ((result: PublishStreamResult) => void) | null = null;
  private rejectResult: ((error: unknown) => void) | null = null;
  private readonly bufferedEvents: PublishStreamEvent[] = [];
  private readonly subscribers = new Set<AsyncPublishEventQueue>();

  public constructor(
    public readonly initial: PublicationInstance<TProvider>,
    private readonly client: Client
  ) { }

  public async *events(): AsyncIterable<PublishStreamEvent> {
    this.start();

    const queue = this.subscribe();
    try {
      for await (const event of queue) {
        yield event;
      }
    } finally {
      this.subscribers.delete(queue);
      queue.close();
    }
  }

  public result(): Promise<PublishStreamResult> {
    this.start();
    return this.resultPromise as Promise<PublishStreamResult>;
  }

  public async publication(): Promise<PublicationInstance<TProvider>> {
    await this.result();
    return this.initial.refresh();
  }

  public start(): this {
    if (this.started) {
      return this;
    }

    const eventStreamUrl = this.initial.data.eventStreamUrl;
    if (!eventStreamUrl) {
      throw new Error(`Publication ${this.initial.data.id} has no eventStreamUrl for SSE streaming`);
    }

    this.started = true;
    this.resultPromise = new Promise((resolve, reject) => {
      this.resolveResult = resolve;
      this.rejectResult = reject;
    });
    this.resultPromise.catch(() => undefined);

    void this.consumeStream(eventStreamUrl);
    return this;
  }

  private subscribe(): AsyncPublishEventQueue {
    const queue = new AsyncPublishEventQueue();

    for (const event of this.bufferedEvents) {
      queue.push(event);
    }

    if (this.finalError) {
      queue.fail(this.finalError);
    } else if (this.completed) {
      queue.close();
    } else {
      this.subscribers.add(queue);
    }

    return queue;
  }

  private async consumeStream(eventStreamUrl: string): Promise<void> {
    try {
      const stream = await this.client.sse(eventStreamUrl);

      for await (const event of readPublishStreamEvents(stream)) {
        this.publish(event);

        if (event.type === 'result') {
          const { type: _, ...result } = event;
          this.finalResult = result;
          this.resolveResult?.(this.finalResult);
        }
      }

      if (!this.finalResult) {
        throw new Error('Publish stream ended without result');
      }

      this.closeSubscribers();
    } catch (err) {
      this.fail(err instanceof Error ? err : new Error(String(err)));
    }
  }

  private publish(event: PublishStreamEvent): void {
    this.bufferedEvents.push(event);
    for (const subscriber of this.subscribers) {
      subscriber.push(event);
    }
  }

  private closeSubscribers(): void {
    this.completed = true;
    for (const subscriber of this.subscribers) {
      subscriber.close();
    }
    this.subscribers.clear();
  }

  private fail(error: unknown): void {
    this.finalError = error;
    this.completed = true;
    this.rejectResult?.(error);
    for (const subscriber of this.subscribers) {
      subscriber.fail(error);
    }
    this.subscribers.clear();
  }
}

export class PublicationInstance<TProvider extends PublicationProviderName = PublicationProviderName> {
  public constructor(
    public readonly data: PublicationData<TProvider>,
    private readonly client: Client,
    private readonly notebookId?: string
  ) { }

  public async refresh(): Promise<PublicationInstance<TProvider>> {
    const response = await this.client.get<PublicationData<TProvider>>(`/publications/${this.data.id}`);

    return new PublicationInstance(response.data, this.client, this.notebookId);
  }

  public async publish(): Promise<PublicationRun<TProvider>> {
    if (!this.notebookId) {
      return Promise.reject(new Error('Publishing requires a notebook-scoped publication instance.'));
    }

    const response = await this.client.post<PublicationData<TProvider>>(
      `/notebook/${this.notebookId}/publication`
    );
    const run = new PublicationRun(
      new PublicationInstance(response.data, this.client, this.notebookId),
      this.client
    );
    run.start();

    return run;
  }

  public async destroy(): Promise<void> {
    await this.client.delete<{ message?: string }>(`/publications/${this.data.id}`);
  }

  public async wait(
    options: { intervalMs?: number; timeoutMs?: number } = {}
  ): Promise<PublicationInstance<TProvider>> {
    const intervalMs = options.intervalMs ?? 1000;
    const timeoutMs = options.timeoutMs ?? 300000;
    const startedAt = Date.now();
    let current: PublicationInstance<TProvider> = this;

    while (!publicationStatusIsTerminal(current.data.status)) {
      if (Date.now() - startedAt > timeoutMs) {
        throw new Error(`Timed out waiting for publication ${this.data.id}`);
      }

      await delay(intervalMs);
      current = await current.refresh();
    }

    return current;
  }

  public async events(): Promise<ReadableStream<PublicationEventData>> {
    return parseNdjsonStream(
      await this.client.stream(`/publications/${this.data.id}/events/stream`),
      PublicationEventDataSchema
    );
  }

  public buildLogs(buildId: string = this.data.latestBuild?.id ?? ''): Promise<ReadableStream<PublicationLogChunkData>> {
    if (buildId === '') {
      return Promise.reject(new Error('Publication has no latest build id'));
    }

    return this.client.stream(`/publications/${this.data.id}/builds/${buildId}/logs/stream`)
      .then((stream) => parseNdjsonStream(stream, PublicationLogChunkDataSchema));
  }

  public async logs(): Promise<ReadableStream<PublicationLogChunkData>> {
    return parseNdjsonStream(
      await this.client.stream(`/publications/${this.data.id}/logs/stream`),
      PublicationLogChunkDataSchema
    );
  }

  public async setProtection(input: UpdatePublicationProtectionInput): Promise<PublicationInstance<TProvider>> {
    const response = await this.client.put<PublicationData<TProvider>>(
      `/publications/${this.data.id}/protection`,
      input
    );

    return new PublicationInstance(response.data, this.client, this.notebookId);
  }

  public async protection(): Promise<PublicationProtectionData> {
    const response = await this.client.get<PublicationProtectionData>(`/publications/${this.data.id}/protection`);

    return response.data;
  }

  public async createProtectionSession(): Promise<PublicationProtectionSessionData> {
    const response = await this.client.post<PublicationProtectionSessionData>(
      `/publications/${this.data.id}/protection/session`
    );

    return response.data;
  }

  public async disableProtection(): Promise<PublicationInstance<TProvider>> {
    const response = await this.client.delete<PublicationData<TProvider>>(`/publications/${this.data.id}/protection`);

    return new PublicationInstance(response.data, this.client, this.notebookId);
  }

}

function publicationStatusIsTerminal(status: PublicationStatus): boolean {
  return ['healthy', 'failed', 'stopped', 'deleted', 'delete_failed'].includes(status);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

class AsyncPublishEventQueue implements AsyncIterable<PublishStreamEvent> {
  private readonly values: PublishStreamEvent[] = [];
  private readonly pending: Array<{
    resolve: (result: IteratorResult<PublishStreamEvent>) => void;
    reject: (error: unknown) => void;
  }> = [];
  private closed = false;
  private error: unknown = null;

  public push(value: PublishStreamEvent): void {
    if (this.closed) {
      return;
    }

    const next = this.pending.shift();
    if (next) {
      next.resolve({ done: false, value });
      return;
    }

    this.values.push(value);
  }

  public close(): void {
    if (this.closed) {
      return;
    }

    this.closed = true;
    for (const next of this.pending.splice(0)) {
      next.resolve({ done: true, value: undefined });
    }
  }

  public fail(error: unknown): void {
    if (this.closed) {
      return;
    }

    this.error = error;
    this.closed = true;
    for (const next of this.pending.splice(0)) {
      next.reject(error);
    }
  }

  public async *[Symbol.asyncIterator](): AsyncIterator<PublishStreamEvent> {
    while (true) {
      const next = await this.next();
      if (next.done) {
        return;
      }
      yield next.value;
    }
  }

  private next(): Promise<IteratorResult<PublishStreamEvent>> {
    const value = this.values.shift();
    if (value) {
      return Promise.resolve({ done: false, value });
    }

    if (this.error) {
      return Promise.reject(this.error);
    }

    if (this.closed) {
      return Promise.resolve({ done: true, value: undefined });
    }

    return new Promise((resolve, reject) => {
      this.pending.push({ resolve, reject });
    });
  }
}

async function* readPublishStreamEvents(stream: ReadableStream<Uint8Array>): AsyncIterable<PublishStreamEvent> {
  const reader = parseSSEStream(stream).getReader();

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        return;
      }

      const event = parsePublishStreamEvent(value);
      if (event) {
        yield event;
      }
    }
  } finally {
    reader.releaseLock();
  }
}

function parsePublishStreamEvent(event: SSEEvent): PublishStreamEvent | null {
  if (!PublishStreamSseEventNameSchema.safeParse(event.event).success) {
    return null;
  }

  return PublishStreamSseEventSchema.parse(event);
}

interface SSEEvent {
  event: string;
  data: unknown;
}

interface ParseSchema<T> {
  parse(input: unknown): T;
}

function parseSSEStream(input: ReadableStream<Uint8Array>): ReadableStream<SSEEvent> {
  const decoder = new TextDecoder();
  let buffer = '';

  return input.pipeThrough(
    new TransformStream<Uint8Array, SSEEvent>({
      transform(chunk, controller) {
        buffer += decoder.decode(chunk, { stream: true });
        const blocks = buffer.split('\n\n');
        buffer = blocks.pop() ?? '';

        for (const block of blocks) {
          const event = parseSSEBlock(block);
          if (event) {
            controller.enqueue(event);
          }
        }
      },
      flush(controller) {
        buffer += decoder.decode();
        if (buffer.trim() !== '') {
          const event = parseSSEBlock(buffer);
          if (event) {
            controller.enqueue(event);
          }
        }
      },
    })
  );
}

function parseSSEBlock(block: string): SSEEvent | null {
  let eventType = 'message';
  let data = '';

  for (const line of block.split('\n')) {
    if (line.startsWith('event: ')) {
      eventType = line.slice(7).trim();
    } else if (line.startsWith('data: ')) {
      data += line.slice(6);
    } else if (line.startsWith('data:')) {
      data += line.slice(5);
    }
  }

  if (data === '') {
    return null;
  }

  try {
    return { event: eventType, data: JSON.parse(data) };
  } catch {
    return { event: eventType, data };
  }
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
