import { PublishStreamSseEventNameSchema, PublishStreamSseEventSchema } from '../schemas/publications.js';
import type { PublishStreamEvent } from '../schemas/publications.js';
import { PHPSandboxError } from '../errors/index.js';

export type { PublishStreamEvent } from '../schemas/publications.js';

/** Consume publishing SSE in browsers or servers, including through an authenticated proxy.
 * Cancels the source when iteration ends early or parsing fails. Fetch cancellation belongs
 * to the caller's AbortSignal. Unknown event names and heartbeat comments are ignored.
 * A complete stream must include a result; set requireResult to false only for fragments.
 */
export async function* readPublicationStream(
  input: Response | ReadableStream<Uint8Array>,
  options: { requireResult?: boolean } = {}
): AsyncIterable<PublishStreamEvent> {
  if (input instanceof Response && (!input.ok || !input.body)) {
    await input.body?.cancel().catch(() => undefined);
    throw new PHPSandboxError(`Publishing stream is unavailable (HTTP ${input.status}).`);
  }
  const stream = input instanceof Response ? input.body! : input;
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let eventName = 'message';
  let data: string[] = [];
  let ended = false;
  let receivedResult = false;

  function dispatch(): PublishStreamEvent | null {
    const name = eventName;
    const lines = data;
    eventName = 'message';
    data = [];
    if (!lines.length || !PublishStreamSseEventNameSchema.safeParse(name).success) {
      return null;
    }
    const raw = lines.join('\n');
    let payload: unknown;
    try {
      payload = JSON.parse(raw);
    } catch {
      payload = raw;
    }
    const event = PublishStreamSseEventSchema.parse({ event: name, data: payload });
    if (event.type === 'result') {
      receivedResult = true;
    }
    return event;
  }

  function line(value: string): PublishStreamEvent | null {
    if (value === '') {
      return dispatch();
    }
    if (value.startsWith(':')) {
      return null;
    }
    const colon = value.indexOf(':');
    const field = colon < 0 ? value : value.slice(0, colon);
    let content = colon < 0 ? '' : value.slice(colon + 1);
    if (content.startsWith(' ')) {
      content = content.slice(1);
    }
    if (field === 'event') {
      eventName = content;
    }
    if (field === 'data') {
      data.push(content);
    }
    return null;
  }

  try {
    while (true) {
      const { done, value } = await reader.read();
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
      // A CR at the end of a chunk may be the first half of CRLF.
      let match: RegExpExecArray | null;
      while ((match = /\r\n|\r|\n/.exec(buffer))) {
        if (!done && match[0] === '\r' && match.index === buffer.length - 1) {
          break;
        }
        const event = line(buffer.slice(0, match.index));
        buffer = buffer.slice(match.index + match[0].length);
        if (event) {
          yield event;
        }
      }
      if (done) {
        ended = true;
        if (buffer) {
          const event = line(buffer);
          if (event) {
            yield event;
          }
        }
        // Preserve the SDK's support for a final event without a trailing blank line.
        const event = dispatch();
        if (event) {
          yield event;
        }
        if (options.requireResult !== false && !receivedResult) {
          throw new PHPSandboxError('Publish stream ended without result');
        }
        return;
      }
    }
  } finally {
    if (!ended) {
      await reader.cancel().catch(() => undefined);
    }
    reader.releaseLock();
  }
}

/** Forward the original bytes with SSE headers and exactly-once resource cleanup.
 * Works with Fetch-based servers and frameworks that accept a standard Response.
 * Does not parse, buffer a replay, or re-encode events. Upstream errors fail the body.
 */
export function createPublicationStreamResponse(
  stream: ReadableStream<Uint8Array>,
  options: { signal?: AbortSignal; onDispose?: () => void | Promise<void> } = {}
): Response {
  const reader = stream.getReader();
  let disposed = false;
  let finished = false;
  let cancellation: Promise<void> | undefined;
  let abort: () => void;

  async function dispose() {
    if (disposed) {
      return;
    }
    disposed = true;
    options.signal?.removeEventListener('abort', abort);
    reader.releaseLock();
    await options.onDispose?.();
  }

  function cancel(reason: unknown): Promise<void> {
    return (cancellation ??= (async () => {
      finished = true;
      try {
        await reader.cancel(reason);
      } finally {
        await dispose();
      }
    })());
  }

  return new Response(
    new ReadableStream<Uint8Array>(
      {
        start(controller) {
          abort = () => {
            controller.error(options.signal!.reason);
            void cancel(options.signal!.reason).catch(() => undefined);
          };
          if (options.signal?.aborted) {
            abort();
          } else {
            options.signal?.addEventListener('abort', abort, { once: true });
          }
        },
        async pull(controller) {
          try {
            const { done, value } = await reader.read();
            if (finished) {
              return;
            }
            if (done) {
              finished = true;
              await dispose();
              controller.close();
            } else {
              controller.enqueue(value);
            }
          } catch (error) {
            if (finished && cancellation) {
              return;
            }
            try {
              await cancel(error);
            } finally {
              controller.error(error);
            }
          }
        },
        cancel,
      },
      { highWaterMark: 0 }
    ),
    {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        'X-Accel-Buffering': 'no',
      },
    }
  );
}
