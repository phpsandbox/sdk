import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import { PHPSandbox, type NotebookData } from '../../src/index.js';

const data: NotebookData = {
  id: 'notebook-1',
  gitUrl: 'https://git.example.test/notebook-1.git',
  runtimeUrl: 'wss://runtime.example.test/n/notebook-1?ticket=signed-ticket',
};

function requestFrom(input: RequestInfo | URL): Request {
  expect(input).toBeInstanceOf(Request);
  if (!(input instanceof Request)) {
    throw new Error('Expected an authenticated Request');
  }
  return input;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('notebook archive downloads', () => {
  it('opens lazily and reads only as the consumer requests chunks', async () => {
    let next = 0;
    const pull = vi.fn((controller: ReadableStreamDefaultController<Uint8Array>) => {
      next += 1;
      controller.enqueue(new Uint8Array([next]));
    });
    const body = new ReadableStream<Uint8Array>({ pull }, { highWaterMark: 0 });
    const fetch = vi.fn<typeof globalThis.fetch>(
      async () =>
        new Response(body, {
          headers: { 'content-type': 'application/zip' },
        })
    );
    const notebook = PHPSandbox.rest('token', undefined, { fetch }).notebook.open(data);
    onTestFinished(() => notebook.dispose());
    const stream = notebook.files.download({ include: ['src/**'], exclude: ['vendor/**'] });
    const reader = stream.getReader();

    expect(fetch).not.toHaveBeenCalled();
    expect(pull).not.toHaveBeenCalled();

    await expect(reader.read()).resolves.toEqual({ done: false, value: new Uint8Array([1]) });
    await Promise.resolve();

    expect(pull).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledOnce();
    const request = requestFrom(fetch.mock.calls[0][0]);
    expect(request.url).toBe('https://runtime.example.test/api/v1/notebooks/notebook-1/runtime/files/download');
    expect(request.method).toBe('POST');
    expect(request.redirect).toBe('manual');
    expect(request.headers.get('authorization')).toBe('Bearer signed-ticket');
    expect(request.headers.get('accept')).toBe('application/zip');
    await expect(request.json()).resolves.toEqual({ include: ['src/**'], exclude: ['vendor/**'] });

    await expect(reader.read()).resolves.toEqual({ done: false, value: new Uint8Array([2]) });
    expect(pull).toHaveBeenCalledTimes(2);

    await reader.cancel('stopped');

    expect(request.signal.aborted).toBe(true);
    expect(body.locked).toBe(false);
  });

  it('closes and releases the response reader at the end of the archive', async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([80, 75, 3, 4]));
        controller.close();
      },
    });
    const fetch = vi.fn<typeof globalThis.fetch>(
      async () =>
        new Response(body, {
          headers: { 'content-type': 'application/zip' },
        })
    );
    const notebook = PHPSandbox.rest('token', undefined, { fetch }).notebook.open(data);
    onTestFinished(() => notebook.dispose());
    const chunks: Uint8Array[] = [];

    for await (const chunk of notebook.files.download()) {
      chunks.push(chunk);
    }

    expect(chunks).toEqual([new Uint8Array([80, 75, 3, 4])]);
    expect(body.locked).toBe(false);
  });

  it('cancels the upstream reader when the consumer stops', async () => {
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          controller.enqueue(new Uint8Array([1]));
        },
        cancel,
      },
      { highWaterMark: 0 }
    );
    const fetch = vi.fn<typeof globalThis.fetch>(
      async () =>
        new Response(body, {
          headers: { 'content-type': 'application/zip' },
        })
    );
    const notebook = PHPSandbox.rest('token', undefined, { fetch }).notebook.open(data);
    onTestFinished(() => notebook.dispose());
    const reader = notebook.files.download().getReader();
    await reader.read();

    await reader.cancel('stopped');

    expect(cancel).toHaveBeenCalledExactlyOnceWith('stopped');
    expect(body.locked).toBe(false);
  });

  it('does not open a request when cancelled before reading', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    const notebook = PHPSandbox.rest('token', undefined, { fetch }).notebook.open(data);
    onTestFinished(() => notebook.dispose());

    await notebook.files.download().cancel();

    expect(fetch).not.toHaveBeenCalled();
  });

  it('propagates a remote permission failure through the stream', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      Response.json(
        {
          error: { status: 403, code: 'PermissionDenied', message: 'Access denied.' },
        },
        { status: 403 }
      )
    );
    const notebook = PHPSandbox.rest('token', undefined, { fetch }).notebook.open(data);
    onTestFinished(() => notebook.dispose());

    await expect(notebook.files.download().getReader().read()).rejects.toMatchObject({
      source: 'runtime',
      status: 403,
      code: 'PermissionDenied',
      message: 'Access denied.',
    });
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('refreshes an expired ticket before streaming and never retries archive bytes', async () => {
    const failure = new Error('Download interrupted');
    const transport = new TransformStream<Uint8Array, Uint8Array>();
    const writer = transport.writable.getWriter();
    onTestFinished(() => writer.abort().catch(() => undefined));
    const body = transport.readable;
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(Response.json({ error: { code: 'AuthenticationRequired' } }, { status: 401 }))
      .mockResolvedValueOnce(new Response(body, { headers: { 'content-type': 'application/zip' } }));
    const runtimeUrlProvider = vi.fn(async () => data.runtimeUrl.replace('signed-ticket', 'fresh-ticket'));
    const notebook = PHPSandbox.rest('token', undefined, { fetch, runtimeUrlProvider }).notebook.open(data);
    onTestFinished(() => notebook.dispose());
    const reader = notebook.files.download().getReader();
    const firstRead = reader.read();
    const written = writer.write(new Uint8Array([1, 2]));
    await expect(firstRead).resolves.toEqual({ done: false, value: new Uint8Array([1, 2]) });

    await written;
    await writer.abort(failure);

    await expect(reader.read()).rejects.toBe(failure);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(runtimeUrlProvider).toHaveBeenCalledExactlyOnceWith('notebook-1');
    expect(requestFrom(fetch.mock.calls[1][0]).headers.get('authorization')).toBe('Bearer fresh-ticket');
    expect(body.locked).toBe(false);
  });

  it('rejects a successful response that is not a ZIP stream', async () => {
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({ cancel });
    const fetch = vi.fn<typeof globalThis.fetch>(
      async () =>
        new Response(body, {
          headers: { 'content-type': 'text/html' },
        })
    );
    const notebook = PHPSandbox.rest('token', undefined, { fetch }).notebook.open(data);
    onTestFinished(() => notebook.dispose());

    await expect(notebook.files.download().getReader().read()).rejects.toMatchObject({ code: 'InvalidResponse' });
    expect(cancel).toHaveBeenCalledOnce();
  });

  it('uses HTTP for downloads when the runtime transport is realtime', async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.close();
      },
    });
    const fetch = vi.fn<typeof globalThis.fetch>(
      async () =>
        new Response(body, {
          headers: { 'content-type': 'application/zip' },
        })
    );
    const notebook = PHPSandbox.realtime('token', undefined, { fetch }).notebook.open(data);
    onTestFinished(() => notebook.dispose());

    await expect(notebook.files.download().getReader().read()).resolves.toEqual({ done: true, value: undefined });

    expect(notebook.runtimeTransport).toBe('realtime');
    expect(fetch).toHaveBeenCalledOnce();
  });
});

it('rejects an already-aborted download without opening a request', async () => {
  const fetch = vi.fn<typeof globalThis.fetch>();
  const notebook = PHPSandbox.rest('token', undefined, { fetch }).notebook.open(data);
  onTestFinished(() => notebook.dispose());
  const controller = new AbortController();
  const reason = new Error('Stopped before reading');
  controller.abort(reason);

  await expect(notebook.files.download({ signal: controller.signal }).getReader().read()).rejects.toBe(reason);

  expect(fetch).not.toHaveBeenCalled();
});

it('aborts a pending response read when its caller signal fires', async () => {
  const cancel = vi.fn();
  const body = new ReadableStream<Uint8Array>({ cancel }, { highWaterMark: 0 });
  const fetch = vi.fn<typeof globalThis.fetch>(
    async () =>
      new Response(body, {
        headers: { 'content-type': 'application/zip' },
      })
  );
  const notebook = PHPSandbox.rest('token', undefined, { fetch }).notebook.open(data);
  onTestFinished(() => notebook.dispose());
  const controller = new AbortController();
  const reason = new Error('Stopped during read');
  const reader = notebook.files.download({ signal: controller.signal }).getReader();
  const pending = reader.read();
  const rejected = expect(pending).rejects.toBe(reason);
  await vi.waitFor(() => expect(body.locked).toBe(true));

  controller.abort(reason);

  await rejected;
  expect(cancel).toHaveBeenCalledExactlyOnceWith(reason);
  expect(requestFrom(fetch.mock.calls[0][0]).signal.aborted).toBe(true);
  expect(body.locked).toBe(false);
});

it('cancels a response that arrives after the consumer cancels', async () => {
  const response = Promise.withResolvers<Response>();
  const cancel = vi.fn();
  const body = new ReadableStream<Uint8Array>({ cancel }, { highWaterMark: 0 });
  const fetch = vi.fn<typeof globalThis.fetch>(() => response.promise);
  const notebook = PHPSandbox.rest('token', undefined, { fetch }).notebook.open(data);
  onTestFinished(() => notebook.dispose());
  const reader = notebook.files.download().getReader();
  const pending = reader.read();
  await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());

  await reader.cancel('stopped');
  response.resolve(new Response(body, { headers: { 'content-type': 'application/zip' } }));

  await expect(pending).resolves.toEqual({ done: true, value: undefined });
  await vi.waitFor(() => expect(cancel).toHaveBeenCalledOnce());
  expect(body.locked).toBe(false);
});

it('cancels active downloads when the notebook is disposed', async () => {
  const cancel = vi.fn();
  const body = new ReadableStream<Uint8Array>({ cancel }, { highWaterMark: 0 });
  const fetch = vi.fn<typeof globalThis.fetch>(
    async () =>
      new Response(body, {
        headers: { 'content-type': 'application/zip' },
      })
  );
  const notebook = PHPSandbox.rest('token', undefined, { fetch }).notebook.open(data);
  onTestFinished(() => notebook.dispose());
  const pending = notebook.files.download().getReader().read();
  const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  await vi.waitFor(() => expect(body.locked).toBe(true));

  notebook.dispose();

  await rejected;
  expect(cancel).toHaveBeenCalledOnce();
  expect(body.locked).toBe(false);
});
