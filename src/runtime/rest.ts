import type { CallOption, Invokable, NotebookData, NotebookInitSuccessResult } from '../index.js';
import { PHPSandboxError, RemoteError, TransportError, remoteError } from '../errors/index.js';
import { authenticatedRequest } from '../http.js';

interface RuntimeActionResponse {
  data?: unknown;
  error?: Record<string, unknown>;
  code?: unknown;
  message?: unknown;
}

type RuntimeHttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
type RestRuntimeAction = keyof Invokable | 'runtime.ready';

interface RestActionRoute {
  method: RuntimeHttpMethod;
  path: string;
}

const restActionRoutes: Readonly<Partial<Record<RestRuntimeAction, RestActionRoute>>> = {
  'runtime.ready': { method: 'GET', path: '/runtime' },
  'config.get': { method: 'GET', path: '/runtime/config' },
  'config.update': { method: 'PATCH', path: '/runtime/config' },
  'config.set-ports': { method: 'PUT', path: '/runtime/config/ports' },
  'container.restart': { method: 'POST', path: '/runtime/container/restart' },
  'container.stop': { method: 'POST', path: '/runtime/container/stop' },
  'container.set-php': { method: 'PUT', path: '/runtime/container/php' },
  'container.opened-ports': { method: 'GET', path: '/runtime/container/ports' },
  'container.resolve-port': { method: 'POST', path: '/runtime/container/ports/resolve' },
  'container.stats': { method: 'GET', path: '/runtime/container/stats' },
  'terminal.list': { method: 'GET', path: '/runtime/terminals' },
  'shell.exec': { method: 'POST', path: '/runtime/executions' },
  'fs.readFile': { method: 'GET', path: '/runtime/files/content' },
  'fs.writeFile': { method: 'PUT', path: '/runtime/files/content' },
  'fs.createDirectory': { method: 'PUT', path: '/runtime/directories' },
  'fs.readDirectory': { method: 'POST', path: '/runtime/directories/read' },
  'fs.stat': { method: 'POST', path: '/runtime/files/stat' },
  'fs.rename': { method: 'POST', path: '/runtime/files/rename' },
  'fs.copy': { method: 'POST', path: '/runtime/files/copy' },
  'fs.delete': { method: 'DELETE', path: '/runtime/files' },
  'fs.tail': { method: 'POST', path: '/runtime/files/tail' },
  'fs.find': { method: 'POST', path: '/runtime/files/find' },
  'fs.textSearch': { method: 'POST', path: '/runtime/files/search' },
  'fs.tree': { method: 'POST', path: '/runtime/files/tree' },
  'service.list': { method: 'GET', path: '/runtime/services' },
  'service.run': { method: 'POST', path: '/runtime/services/run' },
  'service.stop': { method: 'POST', path: '/runtime/services/stop' },
  'service.logs': { method: 'POST', path: '/runtime/services/logs' },
  'composer.invoke': { method: 'POST', path: '/runtime/composer/executions' },
  'composer.packages': { method: 'GET', path: '/runtime/composer/packages' },
  'git.checkpoint': { method: 'POST', path: '/runtime/git/checkpoints' },
  'git.checkout': { method: 'POST', path: '/runtime/git/checkouts' },
  'git.log': { method: 'POST', path: '/runtime/git/log' },
  'git.sync': { method: 'POST', path: '/runtime/git/sync' },
  'git.diff': { method: 'POST', path: '/runtime/git/diff' },
  'git.merge': { method: 'POST', path: '/runtime/git/merge' },
  'git.conflicts': { method: 'GET', path: '/runtime/git/conflicts' },
  'git.resolve': { method: 'POST', path: '/runtime/git/conflicts/resolve' },
  'git.restore': { method: 'POST', path: '/runtime/git/restore' },
  'git.status': { method: 'GET', path: '/runtime/git/status' },
  'git.review': { method: 'GET', path: '/runtime/git/review' },
  'git.stage': { method: 'POST', path: '/runtime/git/stage' },
  'git.unstage': { method: 'POST', path: '/runtime/git/unstage' },
  'git.revert': { method: 'POST', path: '/runtime/git/revert' },
};

export class RestRuntimeInvoker {
  private actionUrl!: URL;
  private ticket!: string;
  private refreshPromise: Promise<void> | null = null;
  private readonly notebookId: string;

  public constructor(
    data: NotebookData,
    private readonly fetch: typeof globalThis.fetch,
    private readonly refresh?: () => Promise<string>
  ) {
    this.notebookId = data.id;
    this.configure(data.runtimeUrl);
  }

  private configure(runtimeUrl: string): void {
    const actionUrl = new URL(runtimeUrl);
    const ticket = actionUrl.searchParams.get('ticket') ?? '';
    if (ticket === '') {
      throw new PHPSandboxError('The notebook connection does not contain a runtime ticket.');
    }

    this.ticket = ticket;
    if (actionUrl.protocol === 'wss:') {
      actionUrl.protocol = 'https:';
    } else if (actionUrl.protocol === 'ws:') {
      actionUrl.protocol = 'http:';
    }
    actionUrl.pathname = `/api/v1/notebooks/${encodeURIComponent(this.notebookId)}`;
    actionUrl.searchParams.delete('ticket');
    actionUrl.hash = '';

    this.actionUrl = actionUrl;
  }

  public ready(): Promise<NotebookInitSuccessResult> {
    return this.invokeRaw('runtime.ready', {}, {});
  }

  public supports(action: string): action is RestRuntimeAction {
    return action in restActionRoutes;
  }

  public invoke<T extends keyof Invokable>(
    action: T,
    data: Invokable[T]['args'] = {},
    options: CallOption = {}
  ): Promise<Invokable[T]['response']> {
    return this.invokeRaw(action, data ?? {}, options);
  }

  public send(): never {
    throw new PHPSandboxError('Fire-and-forget actions require the realtime transport.');
  }

  private async invokeRaw<T>(action: RestRuntimeAction, data: unknown, options: CallOption): Promise<T> {
    const abort = runtimeAbort(options);

    try {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const response = await runtimeFetch(this.fetch, this.request(action, data, abort.signal));
        if (response.status === 401 && attempt === 0 && this.refresh !== undefined) {
          await this.refreshAuthorization();
          continue;
        }

        const payload = await runtimeActionResponse(response);
        if (!response.ok || payload.error !== undefined) {
          throw remoteError('runtime', payload.error, response);
        }

        return payload.data as T;
      }

      throw new RemoteError(`Runtime action ${action} could not be authorized.`, {
        source: 'runtime',
        status: 401,
        code: 'AuthenticationRequired',
      });
    } finally {
      abort.dispose();
    }
  }

  private request(action: RestRuntimeAction, data: unknown, signal: AbortSignal): Request {
    const route = restActionRoutes[action];
    if (route === undefined) {
      throw new PHPSandboxError(`Runtime action ${action} requires the realtime transport.`);
    }
    const url = new URL(this.actionUrl);
    url.pathname += route.path;
    const headers: Record<string, string> = {
      Accept: 'application/json, application/octet-stream',
      Authorization: `Bearer ${this.ticket}`,
    };

    const body = runtimeActionRequestBody(action, data, url, headers);
    return authenticatedRequest(url, {
      method: route.method,
      headers,
      body: route.method === 'GET' ? undefined : body,
      signal,
    });
  }

  private async refreshAuthorization(): Promise<void> {
    if (this.refreshPromise === null) {
      this.refreshPromise = this.refresh!().then((runtimeUrl) => this.configure(runtimeUrl));
    }

    try {
      await this.refreshPromise;
    } finally {
      this.refreshPromise = null;
    }
  }
}

async function runtimeFetch(fetch: typeof globalThis.fetch, request: Request): Promise<Response> {
  try {
    return await fetch(request);
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw error;
    }

    throw new TransportError('Unable to reach the PHPSandbox runtime.', 'ConnectionFailed', error);
  }
}

async function runtimeActionResponse(response: Response): Promise<RuntimeActionResponse> {
  if (response.ok && response.headers.get('content-type')?.toLowerCase().startsWith('application/octet-stream')) {
    return { data: new Uint8Array(await response.arrayBuffer()) };
  }
  const body = await response.text();
  if (body === '') {
    if (response.ok) {
      throw new TransportError('PHPSandbox runtime returned an empty response.', 'InvalidResponse', response);
    }
    return {};
  }

  try {
    return JSON.parse(body) as RuntimeActionResponse;
  } catch (error) {
    throw new TransportError('PHPSandbox runtime returned an invalid JSON response.', 'InvalidResponse', error);
  }
}

function runtimeActionRequestBody(
  action: string,
  data: unknown,
  url: URL,
  headers: Record<string, string>
): BodyInit | undefined {
  const payload = runtimeActionRecord(data);
  if (action === 'fs.readFile') {
    setRequiredRuntimeQuery(url, 'path', payload.path);
    const lineRange = runtimeActionRecord(payload.lineRange);
    if (lineRange.lineStart !== undefined || lineRange.lineEnd !== undefined) {
      setRequiredRuntimeQuery(url, 'lineStart', lineRange.lineStart);
      setRequiredRuntimeQuery(url, 'lineEnd', lineRange.lineEnd);
    }
    return undefined;
  }
  if (action === 'fs.writeFile') {
    setRequiredRuntimeQuery(url, 'path', payload.path);
    const options = runtimeActionRecord(payload.options);
    setBooleanRuntimeQuery(url, 'overwrite', options.overwrite);
    setBooleanRuntimeQuery(url, 'create', options.create);
    setBooleanRuntimeQuery(url, 'unlock', options.unlock);
    const atomic = runtimeActionRecord(options.atomic);
    if (typeof atomic.postfix === 'string' && atomic.postfix !== '') {
      url.searchParams.set('atomicPostfix', atomic.postfix);
    }
    if (!ArrayBuffer.isView(payload.contents)) {
      throw new TypeError('Runtime file contents must be binary data.');
    }
    headers['Content-Type'] = 'application/octet-stream';
    return Uint8Array.from(
      new Uint8Array(payload.contents.buffer, payload.contents.byteOffset, payload.contents.byteLength)
    ).buffer;
  }
  headers['Content-Type'] = 'application/json';
  return JSON.stringify(data);
}

function runtimeActionRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function setRequiredRuntimeQuery(url: URL, name: string, value: unknown): void {
  if ((typeof value !== 'string' && typeof value !== 'number') || String(value) === '') {
    throw new TypeError(`Runtime file ${name} is required.`);
  }
  url.searchParams.set(name, String(value));
}

function setBooleanRuntimeQuery(url: URL, name: string, value: unknown): void {
  url.searchParams.set(name, value === true ? 'true' : 'false');
}

function runtimeAbort(options: CallOption): {
  signal: AbortSignal;
  dispose: () => void;
} {
  if (options.timeout === undefined && options.abortSignal === undefined) {
    return { signal: new AbortController().signal, dispose: () => undefined };
  }

  const controller = new AbortController();
  const abortFromCaller = () => controller.abort(options.abortSignal?.reason);
  options.abortSignal?.addEventListener('abort', abortFromCaller, {
    once: true,
  });
  if (options.abortSignal?.aborted) {
    abortFromCaller();
  }
  const timeout = options.timeout === undefined ? undefined : setTimeout(() => controller.abort(), options.timeout);

  return {
    signal: controller.signal,
    dispose: () => {
      options.abortSignal?.removeEventListener('abort', abortFromCaller);
      if (timeout !== undefined) {
        clearTimeout(timeout);
      }
    },
  };
}
