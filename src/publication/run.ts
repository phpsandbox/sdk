import type { PublicationProviderName } from './types.js';
import type { Client } from '../index.js';
import { PublishStreamSseEventNameSchema, PublishStreamSseEventSchema } from '../schemas/publications.js';
import type { PublishStreamEvent, PublishStreamResult } from '../schemas/publications.js';

import { PHPSandboxError } from '../errors/index.js';
import { PublicationInstance } from './instance.js';

export class PublicationRun<TProvider extends PublicationProviderName = PublicationProviderName> {
  private readonly streamAbort = new AbortController();
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
  ) {}

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
    if (!this.resultPromise) {
      throw new PHPSandboxError('Publication stream could not start.');
    }
    return this.resultPromise;
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
      throw new PHPSandboxError(`Publication ${this.initial.data.id} has no eventStreamUrl for SSE streaming`);
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

  /** Stop observing this run. Once its stream has attached, the server-side publication continues. */
  public dispose(): void {
    if (this.completed) {
      return;
    }
    const error = new DOMException('Stopped observing publication; deployment continues.', 'AbortError');
    if (!this.started) {
      this.started = true;
      this.resultPromise = Promise.reject(error);
      this.resultPromise.catch(() => undefined);
    }
    this.streamAbort.abort(error);
    this.fail(error);
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
      const stream = await this.client.sse(eventStreamUrl, this.streamAbort.signal);

      for await (const event of readPublishStreamEvents(stream)) {
        this.publish(event);

        if (event.type === 'result') {
          const { type: _, ...result } = event;
          this.finalResult = result;
          this.resolveResult?.(this.finalResult);
        }
      }

      if (!this.finalResult) {
        throw new PHPSandboxError('Publish stream ended without result');
      }

      this.closeSubscribers();
    } catch (err) {
      this.fail(err instanceof Error ? err : new PHPSandboxError(String(err), err));
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
