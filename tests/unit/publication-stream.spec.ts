import { describe, expect, it, vi } from 'vitest';
import { createPublicationStreamResponse, readPublicationStream } from '../../src/publication/stream.js';

const encoder = new TextEncoder();
const log = { stream: 'build', content: 'Hello 🌍' };
const frame = `event: log\ndata: ${JSON.stringify(log)}\n\n`;
const result = { success: true, publicationId: 'pub', url: 'https://app.test', buildId: 'build', releaseId: 'release', status: 'healthy' };
async function collect(input: Response | ReadableStream<Uint8Array>, requireResult = false) {
  const events = [];
  for await (const event of readPublicationStream(input, { requireResult })) events.push(event);
  return events;
}
function bytes(chunks: Uint8Array[], cancel = vi.fn()) {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
    cancel,
  });
}

describe('publishing stream consumer', () => {
  it('parses every possible byte boundary, including UTF-8 and split CRLF', async () => {
    const input = encoder.encode(frame.replaceAll('\n', '\r\n'));
    for (let split = 1; split < input.length; split++) {
      expect(await collect(bytes([input.slice(0, split), input.slice(split)]))).toEqual([{ type: 'log', ...log }]);
    }
  });

  it('handles multiline data, no space after colon, heartbeat comments, and unknown events', async () => {
    const input = ':heartbeat\r\revent:future\rdata:not-json\r\revent:phase\rdata:{\rdata:"name":"building"}\r\r';
    expect(await collect(new Response(input))).toEqual([{ type: 'phase', name: 'building' }]);
  });

  it('normalizes done and accepts a final event without a trailing separator', async () => {
    expect(await collect(new Response(`event:done\ndata:${JSON.stringify(result)}`))).toEqual([{ type: 'result', ...result }]);
  });

  it('rejects EOF without a result, including an empty active stream', async () => {
    await expect(collect(new Response(frame), true)).rejects.toThrow('Publish stream ended without result');
    await expect(collect(new Response(''), true)).rejects.toThrow('Publish stream ended without result');
    expect(await collect(new Response(frame + `event: done\ndata: ${JSON.stringify(result)}\n\n`), true))
      .toEqual([{ type: 'log', ...log }, { type: 'result', ...result }]);
  });

  it('rejects invalid payloads and server error events', async () => {
    await expect(collect(new Response('event:log\ndata:{"content":123}\n\n'))).rejects.toThrow();
    await expect(collect(new Response('event:error\ndata:{"message":"Publish failed"}\n\n'))).rejects.toThrow('Publish failed');
    await expect(collect(new Response('event:log\ndata:invalid\n\n'))).rejects.toThrow();
  });

  it('rejects unsuccessful or bodyless responses', async () => {
    await expect(collect(new Response('denied', { status: 403 }))).rejects.toThrow('HTTP 403');
    await expect(collect(new Response(null, { status: 204 }))).rejects.toThrow('HTTP 204');
  });

  it('cancels and unlocks an open source when the caller stops observing', async () => {
    const cancel = vi.fn();
    const source = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(encoder.encode(frame)); }, cancel });
    for await (const event of readPublicationStream(source)) { expect(event.type).toBe('log'); break; }
    expect(cancel).toHaveBeenCalledOnce();
    expect(source.locked).toBe(false);
  });

  it('cancels and unlocks on validation failure', async () => {
    const cancel = vi.fn();
    const source = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(encoder.encode('event:log\ndata:{}\n\n')); }, cancel });
    await expect(collect(source)).rejects.toThrow();
    expect(cancel).toHaveBeenCalledOnce();
    expect(source.locked).toBe(false);
  });
});

describe('transparent publishing stream response', () => {
  it('preserves original bytes and headers and disposes once at EOF', async () => {
    const onDispose = vi.fn();
    const original = encoder.encode(':keep-alive\r\n' + frame);
    const source = bytes([original.slice(0, 5), original.slice(5)]);
    const response = createPublicationStreamResponse(source, { onDispose });
    expect(response.headers.get('Content-Type')).toBe('text/event-stream');
    expect(response.headers.get('Cache-Control')).toBe('no-cache, no-transform');
    expect(response.headers.get('X-Accel-Buffering')).toBe('no');
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(original);
    expect(onDispose).toHaveBeenCalledOnce();
    expect(source.locked).toBe(false);
  });

  it('propagates downstream cancellation and disposes once', async () => {
    const cancel = vi.fn();
    const onDispose = vi.fn();
    const source = new ReadableStream<Uint8Array>({ cancel });
    const response = createPublicationStreamResponse(source, { onDispose });
    await response.body!.cancel('browser disconnected');
    expect(cancel).toHaveBeenCalledWith('browser disconnected');
    expect(onDispose).toHaveBeenCalledOnce();
    expect(source.locked).toBe(false);
  });

  it('cancels a pending read on downstream disconnect', async () => {
    const cancel = vi.fn();
    const onDispose = vi.fn();
    const source = new ReadableStream<Uint8Array>({ cancel });
    const reader = createPublicationStreamResponse(source, { onDispose }).body!.getReader();
    const pending = reader.read();
    await reader.cancel('disconnected');
    expect(await pending).toEqual({ done: true, value: undefined });
    expect(cancel).toHaveBeenCalledOnce();
    expect(onDispose).toHaveBeenCalledOnce();
  });

  for (const timing of ['before creation', 'before reading', 'during reading'] as const) {
    it(`cleans up when aborted ${timing}`, async () => {
      const abort = new AbortController();
      const cancel = vi.fn();
      const onDispose = vi.fn();
      const source = new ReadableStream<Uint8Array>({ cancel });
      if (timing === 'before creation') abort.abort();
      const response = createPublicationStreamResponse(source, { signal: abort.signal, onDispose });
      const reading = timing === 'during reading' ? response.text() : undefined;
      if (!abort.signal.aborted) abort.abort();
      await expect(reading ?? response.text()).rejects.toThrow();
      // Cancellation disposes after the underlying reader cancellation settles.
      await new Promise(resolve => setTimeout(resolve, 0));
      expect(cancel).toHaveBeenCalledOnce();
      expect(onDispose).toHaveBeenCalledOnce();
      expect(source.locked).toBe(false);
    });
  }

  it('fails the body and disposes on upstream transport failure', async () => {
    const onDispose = vi.fn();
    const source = new ReadableStream<Uint8Array>({ start(c) { c.error(new Error('connection lost')); } });
    await expect(createPublicationStreamResponse(source, { onDispose }).text()).rejects.toThrow('connection lost');
    expect(onDispose).toHaveBeenCalledOnce();
    expect(source.locked).toBe(false);
  });

  it('fails the body if EOF cleanup fails instead of leaving a pending read', async () => {
    const response = createPublicationStreamResponse(bytes([]), {
      onDispose: () => { throw new Error('cleanup failed'); },
    });
    await expect(response.text()).rejects.toThrow('cleanup failed');
  });

  it('cancels the whole proxy pipeline when the browser consumer stops', async () => {
    const cancel = vi.fn();
    const onDispose = vi.fn();
    const source = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(encoder.encode(frame)); }, cancel });
    for await (const event of readPublicationStream(createPublicationStreamResponse(source, { onDispose }))) {
      expect(event).toEqual({ type: 'log', ...log });
      break;
    }
    expect(cancel).toHaveBeenCalledOnce();
    expect(onDispose).toHaveBeenCalledOnce();
  });
});
