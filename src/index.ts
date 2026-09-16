import { Filesystem, FilesystemActions, FilesystemEvents } from './filesystem.js';
import Terminals, { TerminalEvents, TerminalActions, type SpawnOptions } from './terminal.js';
import Auth, { AuthActions } from './auth.js';
import Lsp, { LspActions, LspEvents } from './lsp.js';
import Composer, { ComposerActions, ComposerEvents } from './composer.js';
import { LogEvents } from './log.js';
import Runtime, { type PortInfo, type RuntimeActions, type RuntimeEvents } from './runtime.js';
import Repl, { ReplActions, ReplEvents } from './repl.js';
import Shell, { ShellEvents, ShellActions, type ProcessResult, type ShellProcess } from './shell.js';
import Services, { ServiceActions, ServiceEvents } from './services.js';
import Config, { ConfigActions } from './config.js';
import { Transport } from './socket/index.js';
import EventManager, { EventDispatcher } from './events/index.js';
import Git, { GitActions, GitCredentials } from './git.js';
import { Disposable } from './types.js';
import {
  PHPSandboxError,
  RemoteError,
  TransportError,
  remoteError,
} from './errors/index.js';
import {
  PublicationApi,
  PublicationInstance,
  PublicationRun,
  type PublicationData,
  type PublishInput,
} from './publications.js';
import { ServerApi } from './servers.js';
import { RestRuntimeInvoker } from './runtime/rest.js';
import { Feedback } from './feedback.js';
import { IntegrationApi, SandboxIntegrationApi } from './integrations/index.js';
import { authenticatedRequest } from './http.js';

export type { Disposable } from './types.js';
export { LspConnection } from './lsp.js';
export {
  FileChangeFilter,
  FileChangeType,
  FileType,
} from './filesystem.js';
export type {
  FileChange,
  FileContents,
  FileDeleteOptions,
  FileDownloadOptions,
  FileFollowOptions,
  FileLineRange,
  FileLineRangeResult,
  FileListOptions,
  FileOverwriteOptions,
  FileResult,
  FileSearchOptions,
  FileTailOptions,
  FileWriteOptions,
  Filesystem,
  Stats,
  TextSearchMatch,
  TextSearchOptions,
  TextSearchQuery,
  TextSearchResult,
  WatchOptions,
} from './filesystem.js';
export type { PortInfo } from './runtime.js';
export type { RuntimeLogEntry } from './log.js';
export type { RuntimeWatchOptions } from './telemetry.js';
export type { RuntimeResourceUsage, RuntimeStats } from './runtime.js';
export type { ProcessOutputChunk, ProcessOutputSource, ProcessResult, ShellProcess } from './shell.js';
export type { SandboxProcess, SpawnOptions, Task, TerminalOptions } from './terminal.js';
export type {
  GitChangedFile,
  GitCheckoutResult,
  GitConflict,
  GitConflictsResult,
  GitCredentials,
  GitDiffInput,
  GitDiffPreview,
  GitIndexInput,
  GitLog,
  GitMergeInput,
  GitMergeResult,
  GitProvider,
  GitRef,
  GitResolveInput,
  GitResolveResult,
  GitRevertInput,
  GitReview,
  GitReviewFile,
  GitReviewFileStatus,
  GitStatus,
  GitSyncAuthor,
  GitSyncDirection,
  GitSyncExistingTargetInput,
  GitTarget,
  GitTargetConfiguration,
  GitTargetData,
  GitTargetReference,
} from './git.js';
export { notebookBuiltinServices, notebookKnownServices } from './services.js';
export type {
  NotebookBuiltinServiceName,
  NotebookKnownServiceName,
  NotebookServiceCommand,
  NotebookServiceKind,
  NotebookServiceName,
  NotebookServiceSource,
  NotebookServiceState,
  NotebookServiceStatus,
  ServiceLogOptions,
  ServiceLogStreamOptions,
} from './services.js';
export type { ConfigPortMapping, ProjectConfig } from './config.js';
export {
  PHPSandboxError,
  RemoteError,
  TransportError,
} from './errors/index.js';
export type {
  RemoteErrorCode,
  RemoteErrorSource,
  TransportErrorCode,
  ValidationErrorDetails,
} from './errors/index.js';
export type {
  BuiltInPublicationProviderName,
  CloudflareContainersProviderOptions,
  LaravelCloudProviderData,
  LaravelCloudProviderInput,
  LaravelCloudRegion,
  PublicationBuildData,
  PublicationBuildStatus,
  PublicationData,
  PublicationEventData,
  PublicationInstance,
  PublicationJurisdiction,
  PublicationLogChunkData,
  PublicationLogStream,
  PublicationPlacement,
  PublicationProtectionData,
  PublicationProtectionInput,
  PublicationProtectionMode,
  PublicationProtectionSessionData,
  PublicationProvider,
  PublicationProviderData,
  PublicationProviderInput,
  PublicationProviderInputs,
  PublicationProviderName,
  PublicationRegion,
  PublicationReleaseData,
  PublicationReleaseStatus,
  PublicationRun,
  PublicationSize,
  PublicationStatus,
  PublishInput,
  PublishStreamEvent,
  PublishStreamLog,
  PublishStreamPhase,
  PublishStreamResult,
  PublishStreamSseEvent,
  SshServerProviderOptions,
  UpdatePublicationProtectionInput,
} from './publications.js';
export type { CreateServerInput, ServerData, ServerInstance, ServerListOptions, ServerSshOptions } from './servers.js';
export type {
  ConfigureFeedbackInput,
  FeedbackData,
  FeedbackListOptions,
  FeedbackSource,
  FeedbackStatus,
  FeedbackType,
  FeedbackWidgetConfig,
  FeedbackWidgetTarget,
  SubmitFeedbackInput,
  UpdateFeedbackInput,
} from './feedback.js';
export type {
  Integration,
  IntegrationAuthorization,
  IntegrationAuthorizationType,
  IntegrationData,
  IntegrationProvider,
  IntegrationReference,
  LinkIntegrationInput,
  UpdateIntegrationInput,
  AttachSandboxIntegrationInput,
  SandboxIntegration,
  SandboxIntegrationData,
  SandboxIntegrationEffect,
  SandboxIntegrationReference,
  UpdateSandboxIntegrationInput,
} from './integrations/index.js';

interface Result<TType extends 'success' | 'error' | 'running', TData extends object> {
  type: TType;
  message: string;
  data: TData;
}

export type NotebookProvisioningAction = 'github_import' | 'imported_project' | 'forked' | 'template';

export type NotebookInitResponse = {
  env: { name: string; value: string }[];
  previewUrl: string;
  ports: PortInfo[];
  provisioned: boolean;
  provisioningAction: NotebookProvisioningAction | null;
};
export type NotebookInitProgressKind = 'phase' | 'log' | 'heartbeat';

export interface NotebookInitProgress {
  message: string;
  details?: string;
  kind?: NotebookInitProgressKind;
  step?: string;
  line?: string;
  chunk?: string;
  command?: string;
}

export type NotebookInitErrorCode =
  | 'GitHubImportCredentialMissing'
  | 'NotebookDiskQuotaExceeded'
  | 'NotebookNotFound'
  | 'NotebookSetupJsonInvalid'
  | 'NotebookBackupRestoreFailed';

export interface NotebookInitErrorData {
  errorCode?: NotebookInitErrorCode;
  details?: string;
  retryable?: boolean;
  suggestedAction?: string;
  phase?: string;
  quotaMb?: number;
  usedMb?: number;
  provider?: string;
  repository?: string;
  branch?: string | null;
}

export type NotebookInitSuccessResult = Result<'success', NotebookInitResponse>;
export type NotebookInitFailureResult = Result<'error', NotebookInitErrorData>;
export type NotebookInitResult = NotebookInitSuccessResult | NotebookInitFailureResult;
export interface NotebookEvents {
  'lsp.response': object;
  'lsp.close': { code: number; reason: string };
  'init.event': NotebookInitProgress;
  'notebook.initialized': NotebookInitResult;
  'okra.boot_error': RemoteError<'NotebookUnavailable'>;
}

export interface CallOption {
  responseEvent?: string;
  timeout?: number;
  abortSignal?: AbortSignal;
}

export interface Action<Args = object, Response = void> {
  args: Args;
  response: Response;
}

export type Events = TerminalEvents &
  RuntimeEvents &
  LspEvents &
  ComposerEvents &
  LogEvents &
  ServiceEvents &
  NotebookEvents &
  ReplEvents &
  ShellEvents &
  FilesystemEvents;

export type Invokable = TerminalActions &
  RuntimeActions &
  FilesystemActions &
  AuthActions &
  LspActions &
  ComposerActions &
  ServiceActions &
  ConfigActions &
  ReplActions &
  ShellActions &
  GitActions;

export interface CreateNotebookImportAuthInput {
  accessToken: string;
}

export interface CreateNotebookImportInput {
  provider: 'github';
  repo: string;
  branch?: string;
  ref?: string;
  auth: CreateNotebookImportAuthInput;
}

export type InspectNotebookImportInput = CreateNotebookImportInput;

export interface NotebookImportRequiredSecret {
  name: string;
  description: string | null;
}

export interface NotebookImportInspectionData {
  supported: boolean;
  repository: string;
  branch: string;
  ref: string;
  framework: 'laravel' | 'adonisjs' | 'custom' | null;
  template: string | null;
  reason: string | null;
  requiredSecrets: NotebookImportRequiredSecret[];
}

export interface NotebookLifecycleInput {
  persistent?: true;
}

export interface CreateNotebookInput extends NotebookLifecycleInput {
  title: string;
  visibility: 'public' | 'private' | 'unlisted';
  import?: CreateNotebookImportInput;
  composerCredentials?: ComposerCredentialInput[];
  secrets?: UpsertNotebookSecretItemInput[];
}

export type ForkNotebookInput = NotebookLifecycleInput;

export interface NotebookPolicyData {
  autoDeleteWhenStale: boolean;
  staleAfterMinutes: number | null;
  pruneAfterAt: string | null;
}

export type SecretEnvironment = 'development' | 'production';

export type SecretType = 'environment_variable' | 'credential';

export interface SecretRef {
  secret: string;
  environment?: SecretEnvironment;
}

export interface NotebookSecretData {
  uuid: string;
  name: string;
  type: SecretType;
  environment: SecretEnvironment;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface NotebookSecretListOptions {
  environment?: SecretEnvironment;
}

export interface UpsertNotebookSecretInput {
  value: string;
  type?: SecretType;
  environment?: SecretEnvironment;
}

export interface UpsertNotebookSecretItemInput extends UpsertNotebookSecretInput {
  name: string;
}

export type UpsertNotebookSecretsInput =
  | UpsertNotebookSecretItemInput[]
  | Record<string, string | UpsertNotebookSecretInput>;

export interface NotebookSecretDeleteOptions {
  environment?: SecretEnvironment;
}

export type ComposerCredentialType =
  | 'github-oauth'
  | 'gitlab-oauth'
  | 'gitlab-token'
  | 'bitbucket-oauth'
  | 'http-basic'
  | 'bearer';

export type ComposerCredentialInput =
  | { type: 'github-oauth'; token: string }
  | { type: 'gitlab-oauth'; url: string; token: string }
  | { type: 'gitlab-token'; url: string; token: string }
  | { type: 'bitbucket-oauth'; consumerKey: string; consumerSecret: string }
  | { type: 'http-basic'; url: string; username: string; password: string }
  | { type: 'bearer'; url: string; token: string };

export interface ComposerCredentialInfo {
  type: ComposerCredentialType;
  url: string;
  username?: string;
}

export interface NotebookPreviewDataDisabled {
  enabled: false;
}

export interface NotebookPreviewDataEnabled {
  enabled: true;
  token: string;
  expiresAt: string;
}

export type NotebookPreviewData = NotebookPreviewDataDisabled | NotebookPreviewDataEnabled;

export type NotebookPreviewDataWithUrl = NotebookPreviewDataDisabled | (NotebookPreviewDataEnabled & { url: string });

export interface SetNotebookPreviewInput {
  password: string;
}

export interface NotebookPreviewSessionData {
  previewSessionId: string;
  token: string;
  expiresAt: string;
  url: string;
}

export interface CreateNotebookPreviewSessionInput {
  url: string;
}

export interface CreateNotebookPreviewHandoffInput {
  previewSessionId: string;
  expiresInSeconds?: number;
  url: string;
}

export interface NotebookPreviewHandoffData {
  handoffId: string;
  previewSessionId: string;
  token: string;
  expiresAt: string;
  url: string;
}

export interface NotebookMailRecipientData {
  name?: string;
  address: string;
}

export interface NotebookMailData {
  senderName: string;
  senderEmail: string;
  recipients: NotebookMailRecipientData[];
  hash: string;
  subject: string;
  attachmentCount: number;
  createdAt: string;
  diffForHumans: string;
  html: string | null;
}

export interface NotebookMailStateData {
  enabled: boolean;
  username: string;
  host: string;
  port: number;
  mailer: 'smtp';
}

export interface PaginatedApiResponse<TData> {
  data: TData[];
  links?: Record<string, unknown>;
  meta?: Record<string, unknown>;
}

export interface NotebookMailListOptions {
  page?: number;
}

function normalizeNotebookSecretInputs(input: UpsertNotebookSecretsInput): UpsertNotebookSecretItemInput[] {
  if (Array.isArray(input)) {
    return input;
  }

  return Object.entries(input).map(([name, value]) => ({
    name,
    ...(typeof value === 'string' ? { value } : value),
  }));
}

class NotebookApi {
  public constructor(private readonly client: Client) {}

  public async inspectImport(input: InspectNotebookImportInput): Promise<NotebookImportInspectionData> {
    const response = await this.client.post<NotebookImportInspectionData>('/notebook/imports/inspect', input);

    return response.data;
  }

  public async create(template: string, input: Partial<CreateNotebookInput> = {}): Promise<NotebookInstance> {
    const response = await this.client.post<NotebookData>('/notebook', { template, ...input });

    return new NotebookInstance(response.data, this.client);
  }

  public async get(id: string): Promise<NotebookInstance> {
    const response = await this.client.get<NotebookData>(`/notebook/${id}`);

    return new NotebookInstance(response.data, this.client);
  }

  public open(data: NotebookData): NotebookInstance {
    return new NotebookInstance(data, this.client);
  }

}

export interface PHPSandboxClientOptions {
  debug?: boolean;
  fetch?: typeof globalThis.fetch;
  webSocket?: unknown;
  runtimeUrlProvider?: (notebookId: string) => Promise<string>;
}

export type RuntimeTransport = 'realtime' | 'rest';

function normalizeApiBaseUrl(url: string): string {
  const baseUrl = new URL(url);
  const pathname = baseUrl.pathname.replace(/\/+$/, '');

  baseUrl.pathname = pathname === '' || pathname === '/' ? '/v1/' : `${pathname}/`;
  baseUrl.search = '';
  baseUrl.hash = '';

  return baseUrl.toString();
}

class ClientImplementation {
  public readonly notebook: NotebookApi;
  public readonly publications: PublicationApi;
  public readonly servers: ServerApi;
  public readonly integrations: IntegrationApi;
  public readonly options: PHPSandboxClientOptions;
  private readonly runtimeTransportValue: RuntimeTransport;

  public get runtimeTransport(): RuntimeTransport {
    return this.runtimeTransportValue;
  }

  private readonly fetch: typeof globalThis.fetch = globalThis.fetch;

  private readonly baseUrl: string;

  private readonly headers: Record<string, string>;

  public constructor(
    token: string,
    url: string = 'https://api.phpsandbox.io/v1',
    options: PHPSandboxClientOptions = {},
    runtimeTransport: RuntimeTransport = 'realtime'
  ) {
    this.publications = new PublicationApi(this);
    this.notebook = new NotebookApi(this);
    this.servers = new ServerApi(this);
    this.integrations = new IntegrationApi(this);
    this.options = { ...options };
    this.runtimeTransportValue = runtimeTransport;
    this.baseUrl = normalizeApiBaseUrl(url);

    if (options.fetch) {
      this.fetch = options.fetch;
    }

    this.headers = {
      'Accept': 'application/json',
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    };
  }

  public get<T extends unknown>(path: string): Promise<{ data: T }> {
    return this.makeRequest<T>('GET', path);
  }

  public post<T extends unknown>(path: string, body?: unknown): Promise<{ data: T }> {
    return this.makeRequest<T>('POST', path, { body: body === undefined ? undefined : JSON.stringify(body) });
  }

  public delete<T extends unknown>(path: string): Promise<{ data: T }> {
    return this.makeRequest<T>('DELETE', path);
  }

  public put<T extends unknown>(path: string, body?: unknown): Promise<{ data: T }> {
    return this.makeRequest<T>('PUT', path, { body: body === undefined ? undefined : JSON.stringify(body) });
  }

  public patch<T extends unknown>(path: string, body?: unknown): Promise<{ data: T }> {
    return this.makeRequest<T>('PATCH', path, { body: body === undefined ? undefined : JSON.stringify(body) });
  }

  public async stream(path: string): Promise<ReadableStream<Uint8Array>> {
    const response = await this.fetchResponse(
      authenticatedRequest(new URL(path.replace(/^\//, ''), this.baseUrl), {
        method: 'GET',
        headers: this.headers,
      })
    );

    if (!response.ok) {
      throw remoteError('core', errorPayload(await responsePayload(response)), response);
    }

    if (!response.body) {
      throw new TransportError('PHPSandbox API response body is not readable.', 'InvalidResponse', response);
    }

    return response.body;
  }

  public async sse(url: string): Promise<ReadableStream<Uint8Array>> {
    const response = await this.fetchResponse(
      authenticatedRequest(url, {
        method: 'GET',
        headers: {
          ...this.headers,
          'Accept': 'text/event-stream',
        },
      })
    );

    if (!response.ok) {
      throw remoteError('core', errorPayload(await responsePayload(response)), response);
    }

    if (!response.body) {
      throw new TransportError('PHPSandbox API SSE response body is not readable.', 'InvalidResponse', response);
    }

    return response.body;
  }

  private async makeRequest<T>(method: string, path: string, init?: RequestInit): Promise<{ data: T }> {
    const response = await this.fetchResponse(
      authenticatedRequest(new URL(path.replace(/^\//, ''), this.baseUrl), {
        method,
        ...init,
        headers: this.headers,
      })
    );

    if (!response.ok) {
      throw remoteError('core', errorPayload(await responsePayload(response)), response);
    }

    if (response.status === 204) {
      return { data: undefined };
    }

    const body = await response.text();
    if (body === '') {
      throw new TransportError('PHPSandbox API returned an empty response.', 'InvalidResponse', response);
    }

    try {
      const payload: unknown = JSON.parse(body);
      if (payload === null || typeof payload !== 'object' || Array.isArray(payload) || !Object.prototype.hasOwnProperty.call(payload, 'data')) {
        throw new TransportError('PHPSandbox API returned an invalid success response.', 'InvalidResponse', response);
      }

      return payload as { data: T };
    } catch (error) {
      if (TransportError.is(error)) {
        throw error;
      }

      throw new TransportError('PHPSandbox API returned an invalid JSON response.', 'InvalidResponse', error);
    }
  }

  private async fetchResponse(request: Request): Promise<Response> {
    try {
      return await this.fetch(request);
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        throw error;
      }

      throw new TransportError('Unable to reach the PHPSandbox API.', 'ConnectionFailed', error);
    }
  }
}

async function responsePayload(response: Response): Promise<unknown> {
  const body = await response.text();
  if (body === '') {
    return undefined;
  }

  try {
    return JSON.parse(body);
  } catch (error) {
    throw new TransportError('PHPSandbox API returned an invalid JSON response.', 'InvalidResponse', error);
  }
}

function errorPayload(payload: unknown): unknown {
  return payload !== null && typeof payload === 'object' && !Array.isArray(payload)
    ? (payload as Record<string, unknown>).error
    : undefined;
}

export type Client = ClientImplementation;

export class PHPSandbox {
  public readonly notebook: NotebookApi;
  public readonly publications: PublicationApi;
  public readonly servers: ServerApi;
  public readonly integrations: IntegrationApi;

  private constructor(private readonly client: ClientImplementation) {
    this.notebook = client.notebook;
    this.publications = client.publications;
    this.servers = client.servers;
    this.integrations = client.integrations;
  }

  public get runtimeTransport(): RuntimeTransport {
    return this.client.runtimeTransport;
  }

  public static realtime(
    token: string,
    url: string = 'https://api.phpsandbox.io/v1',
    options: PHPSandboxClientOptions = {}
  ): PHPSandbox {
    return new PHPSandbox(new ClientImplementation(token, url, options));
  }

  public static rest(
    token: string,
    url: string = 'https://api.phpsandbox.io/v1',
    options: PHPSandboxClientOptions = {}
  ): PHPSandbox {
    return new PHPSandbox(new ClientImplementation(token, url, options, 'rest'));
  }
}

export interface NotebookData {
  id: string;
  runtimeUrl: string;
  gitUrl: string;
  type?: string;
  title?: string;
  slug?: string;
  description?: string | null;
  policy?: NotebookPolicyData;
}

export class NotebookInstance {
  public readonly files: Filesystem;
  public readonly terminals: Terminals;
  public readonly auth: Auth;
  public readonly lsp: Lsp;
  public readonly composer: Composer;
  public readonly runtime: Runtime;
  public readonly repl: Repl;
  private readonly shell: Shell;
  public readonly git: Git;
  public readonly services: Services;
  public readonly config: Config;
  public readonly secrets: NotebookSecrets;
  public readonly integrations: SandboxIntegrationApi;
  public readonly preview: NotebookPreview;
  public readonly mail: NotebookMail;
  public readonly feedback: Feedback;
  private readonly socket: Transport | null;
  private readonly restInvoker: RestRuntimeInvoker | null;
  private readonly emitter: EventDispatcher;

  public initialized: NotebookInitResult | false = false;

  public get runtimeTransport(): RuntimeTransport {
    return this.client.runtimeTransport;
  }

  #initPromise: Promise<NotebookInitSuccessResult> | null = null;

  private readonly disposables: Disposable[] = [];

  public constructor(
    public readonly data: NotebookData,
    protected client: Client
  ) {
    const runtimeUrlProvider = client.options.runtimeUrlProvider;

    this.emitter = EventManager.createInstance();
    if (client.runtimeTransport === 'rest') {
      this.socket = null;
      this.restInvoker = new RestRuntimeInvoker(
        data,
        client.options.fetch ?? globalThis.fetch,
        runtimeUrlProvider === undefined
          ? undefined
          : () => runtimeUrlProvider(data.id)
      );
    } else {
      this.restInvoker = null;
      let initialConnection = true;
      const connectionUrl = runtimeUrlProvider === undefined
        ? data.runtimeUrl
        : async () => {
          if (initialConnection) {
            initialConnection = false;
            return data.runtimeUrl;
          }

          return runtimeUrlProvider(data.id);
        };
      this.socket = new Transport(connectionUrl, this.emitter, {
        debug: client.options.debug,
        webSocket: client.options.webSocket,
      });
      this.watchConnection();
      this.#initPromise = this.#init();
    }

    this.files = new Filesystem(
      this,
      this.socket === null ? null : (handler) => this.onDidConnect(handler)
    );
    this.terminals = new Terminals(this);
    this.auth = new Auth(this);
    this.lsp = new Lsp(this);
    this.composer = new Composer(this, client);
    this.runtime = new Runtime(this);
    this.repl = new Repl(this);
    this.shell = new Shell(this);
    this.git = new Git(this, client);
    this.services = new Services(this);
    this.config = new Config(this);
    this.secrets = new NotebookSecrets(client, this.data.id);
    this.integrations = new SandboxIntegrationApi(this.data.id, client);
    this.preview = new NotebookPreview(client, this.data.id);
    this.mail = new NotebookMail(client, this.data.id);
    this.feedback = new Feedback(client, this.data.id);
  }

  public async ready(): Promise<NotebookInitSuccessResult> {
    if (this.restInvoker !== null) {
      return this.restInitialization();
    }

    const socket = this.realtimeSocket();
    const terminalError = socket.getTerminalError();
    if (terminalError) {
      throw terminalError;
    }

    const ready = async () => {
      /**
       * If ready is called, ensure the websocket is open so server-driven
       * initialization can begin, but do not block on an extra ping roundtrip.
       */
      if (!socket.isConnected) {
        await socket.connect();
      }

      return this.#initPromise!;
    };

    // Let the underlying ReconnectingWebSocket handle connection retries
    // Just apply a reasonable timeout for the entire initialization process
    return ready();
  }

  public async fork(input: Partial<ForkNotebookInput> = {}): Promise<NotebookInstance> {
    const response = await this.client.post<NotebookData>(`/notebook/${this.data.id}/fork`, input);

    return new NotebookInstance(response.data, this.client);
  }

  public async publication(): Promise<PublicationInstance | null> {
    try {
      const response = await this.client.get<PublicationData>(`/notebook/${this.data.id}/publication`);

      return new PublicationInstance(response.data, this.client, this.data.id);
    } catch (error) {
      if (RemoteError.is(error) && error.status === 404) {
        return null;
      }

      throw error;
    }
  }

  public async publish(input?: PublishInput): Promise<PublicationRun> {
    const response = await this.client.post<PublicationData>(`/notebook/${this.data.id}/publication`, input);
    const run = new PublicationRun(new PublicationInstance(response.data, this.client, this.data.id), this.client);
    run.start();

    return run;
  }

  public run(command: string | string[], opts?: SpawnOptions): ShellProcess;
  public run(command: string, args: string[], opts?: SpawnOptions): ShellProcess;
  public run(command: string | string[], argsOrOpts: string[] | SpawnOptions = [], opts?: SpawnOptions): ShellProcess {
    if (Array.isArray(argsOrOpts)) {
      return this.shell.run(command as string, argsOrOpts, opts);
    }

    return this.shell.run(command, argsOrOpts);
  }

  public exec(command: string | string[], opts?: SpawnOptions): Promise<ProcessResult>;
  public exec(command: string, args: string[], opts?: SpawnOptions): Promise<ProcessResult>;
  public exec(
    command: string | string[],
    argsOrOpts: string[] | SpawnOptions = [],
    opts?: SpawnOptions
  ): Promise<ProcessResult> {
    if (Array.isArray(argsOrOpts)) {
      return this.run(command as string, argsOrOpts, opts).wait();
    }

    return this.run(command, argsOrOpts).wait();
  }

  public async destroy(): Promise<void> {
    await this.client.delete<void>(`/notebook/${this.data.id}`);
    this.socket?.terminate(new RemoteError('Notebook has been deleted.', {
      source: 'runtime',
      status: 503,
      code: 'NotebookUnavailable',
      details: { id: this.data.id },
    }));
  }

  public restart(): Promise<void> {
    return this.invoke('container.restart');
  }

  public stop(): Promise<void> {
    return this.invoke('container.stop');
  }

  public invoke<T extends keyof Invokable>(
    action: T,
    data: Invokable[T]['args'] = {},
    options: CallOption = {}
  ): Promise<Invokable[T]['response']> {
    if (this.restInvoker !== null) {
      if (this.restInvoker.supports(String(action))) {
        void this.restInitialization();
      }

      return this.restInvoker.invoke(action, data || {}, options);
    }

    return this.realtimeSocket().invoke(action, data || {}, options) as Promise<Invokable[T]['response']>;
  }

  public send<T extends keyof Invokable>(action: T, data: Invokable[T]['args'] = {}): boolean {
    if (this.restInvoker !== null) {
      return this.restInvoker.send();
    }

    return this.realtimeSocket().send(action, data || {});
  }

  public listen<T extends keyof Events>(event: T, handler: (data: Events[T]) => void): Disposable;
  public listen(event: string, handler: (data: unknown) => void): Disposable;
  public listen(event: string, handler: Function): Disposable {
    const disposable = this.emitter.listen(event, handler as (data: unknown) => void);
    this.disposables.push(disposable);

    return disposable;
  }

  public dispose(): void {
    this.disposables.forEach((d) => d.dispose());
    if (this.socket !== null && !this.socket.isClosed) {
      this.socket.disconnect();
    }
  }

  public connected(): Promise<NotebookInstance> {
    return this.waitForSocketConnection({ rejectOnClose: true });
  }

  private waitForSocketConnection(options: { rejectOnClose: boolean }): Promise<NotebookInstance> {
    const socket = this.realtimeSocket();
    const terminalError = socket.getTerminalError();
    if (terminalError) {
      return Promise.reject(terminalError);
    }

    if (socket.isConnected) {
      return Promise.resolve(this);
    }

    return new Promise((resolve, reject) => {
      const disposables: Disposable[] = [];
      let settled = false;

      const cleanup = () => {
        for (const disposable of disposables) {
          disposable.dispose();
        }

        disposables.length = 0;
      };

      const settle = (callback: () => void) => {
        if (settled) {
          return;
        }

        settled = true;
        cleanup();
        callback();
      };

      try {
        disposables.push(socket.onDidConnect(() => settle(() => resolve(this))));

        if (options.rejectOnClose) {
          disposables.push(socket.onDidClose(() => settle(() => reject(new Error('Connection closed')))));
        }

        disposables.push(socket.onDidBootError((error) => settle(() => reject(error))));
      } catch (e) {
        settle(() => reject(e));
      }
    });
  }

  private watchConnection(): void {
    const socket = this.realtimeSocket();
    socket.onDidConnect(() => {
      socket.emit('okra.connected');
    });

    socket.onDidClose(() => {
      socket.emit('okra.disconnected');
      this.initialized = false;
    });

    socket.onDidBootError((error) => {
      socket.emit('okra.boot_error', error);
      socket.emit('okra.disconnected');
      this.initialized = false;
    });
  }

  public onDidConnect(handler: () => void): Disposable {
    const socket = this.realtimeSocket();
    socket.removeListener('okra.connected', handler);

    const disposable = socket.listen('okra.connected', handler);
    this.disposables.push(disposable);

    return disposable;
  }

  public onDidDisconnect(handler: () => void): Disposable {
    const disposable = this.realtimeSocket().listen('okra.disconnected', handler);
    this.disposables.push(disposable);

    return disposable;
  }

  public onDidBootError(handler: (error: RemoteError<'NotebookUnavailable'>) => void): Disposable {
    const disposable = this.realtimeSocket().listen('okra.boot_error', handler);
    this.disposables.push(disposable);

    return disposable;
  }

  #init(): Promise<NotebookInitSuccessResult> {
    this.#initPromise = new Promise<NotebookInitSuccessResult>((resolve, reject) => {
      const initializationListener = this.onDidInitialize((result: NotebookInitResult) => {
        bootErrorListener.dispose();
        initializationListener.dispose();
        this.initialized = result;
        if (result.type === 'error') {
          reject(new RemoteError(result.message, {
            source: 'runtime',
            status: 503,
            code: 'NotebookInitializationFailed',
            details: result.data as NotebookInitErrorData,
          }));
          return;
        }

        resolve(result);
      });

      const bootErrorListener = this.onDidBootError((error) => {
        initializationListener.dispose();
        bootErrorListener.dispose();
        reject(error);
      });
    });

    // `client.notebook.get()` constructs a NotebookInstance without forcing callers
    // to await initialization immediately. Keep the promise handled so a later boot
    // or init failure does not surface as an unhandled rejection in Node, while
    // preserving rejection for callers that explicitly await `ready()`.
    void this.#initPromise.catch(() => { });

    return this.#initPromise;
  }

  private restInitialization(): Promise<NotebookInitSuccessResult> {
    if (this.restInvoker === null) {
      throw new PHPSandboxError('This operation requires the REST transport.');
    }

    if (this.#initPromise === null) {
      this.#initPromise = this.restInvoker.ready().then((result) => {
        this.initialized = result;
        this.emitter.emit('notebook.initialized', result);
        return result;
      });
      void this.#initPromise.catch(() => {});
    }

    return this.#initPromise;
  }

  public onDidInitialize(handler: (result: NotebookInitResult) => void): Disposable {
    return this.listen('notebook.initialized', handler);
  }

  public async reconnect(): Promise<NotebookInstance> {
    const socket = this.realtimeSocket();
    const whenConnected = this.waitForSocketConnection({ rejectOnClose: false });
    // Use the socket's reconnect method which preserves listeners
    // and uses the underlying ReconnectingWebSocket mechanism
    socket.reconnect();

    // Reset initialization state
    this.initialized = false;

    // Wait for the socket to reconnect
    await whenConnected;

    // Re-initialize the notebook
    this.#init();

    // Wait for initialization to complete
    return this.ready().then(() => this);
  }

  private realtimeSocket(): Transport {
    if (this.socket === null) {
      throw new PHPSandboxError('This operation requires the realtime transport.');
    }

    return this.socket;
  }
}

class NotebookSecrets {
  public constructor(
    private readonly client: Client,
    private readonly notebookId: string
  ) { }

  public async list(options?: NotebookSecretListOptions): Promise<NotebookSecretData[]> {
    const params = new URLSearchParams();
    if (options?.environment) params.set('environment', options.environment);
    const query = params.toString();
    const response = await this.client.get<NotebookSecretData[]>(
      `/notebook/${this.notebookId}/secrets${query ? `?${query}` : ''}`
    );

    return response.data;
  }

  public async set(name: string, input: string | UpsertNotebookSecretInput): Promise<NotebookSecretData> {
    const payload = typeof input === 'string' ? { name, value: input } : { name, ...input };
    const response = await this.client.put<NotebookSecretData>(`/notebook/${this.notebookId}/secrets`, payload);

    return response.data;
  }

  public async setMany(input: UpsertNotebookSecretsInput): Promise<NotebookSecretData[]> {
    const response = await this.client.put<NotebookSecretData[]>(`/notebook/${this.notebookId}/secrets`, {
      secrets: normalizeNotebookSecretInputs(input),
    });

    return response.data;
  }

  public async delete(name: string, options?: NotebookSecretDeleteOptions): Promise<void> {
    const params = new URLSearchParams();
    if (options?.environment) params.set('environment', options.environment);
    const query = params.toString();
    await this.client.delete<void>(
      `/notebook/${this.notebookId}/secrets/${encodeURIComponent(name)}${query ? `?${query}` : ''}`
    );
  }
}

class NotebookPreview {
  public constructor(
    private readonly client: Client,
    private readonly notebookId: string
  ) { }

  public get(): Promise<NotebookPreviewData>;
  public get(url: string): Promise<NotebookPreviewDataWithUrl>;
  public async get(url?: string): Promise<NotebookPreviewData> {
    const query = url === undefined ? '' : `?${new URLSearchParams({ url }).toString()}`;
    const response = await this.client.get<NotebookPreviewData>(`/notebook/${this.notebookId}/preview${query}`);

    return response.data;
  }

  public async setPassword(input: SetNotebookPreviewInput): Promise<NotebookPreviewData> {
    const response = await this.client.put<NotebookPreviewData>(`/notebook/${this.notebookId}/preview`, input);

    return response.data;
  }

  public async disable(): Promise<void> {
    await this.client.delete<void>(`/notebook/${this.notebookId}/preview`);
  }

  public async createSession(input: CreateNotebookPreviewSessionInput): Promise<NotebookPreviewSessionData> {
    const response = await this.client.post<NotebookPreviewSessionData>(
      `/notebook/${this.notebookId}/preview/session`,
      input
    );

    return response.data;
  }

  public async createHandoff(input: CreateNotebookPreviewHandoffInput): Promise<NotebookPreviewHandoffData> {
    const response = await this.client.post<NotebookPreviewHandoffData>(
      `/notebook/${this.notebookId}/preview/handoff`,
      input
    );

    return response.data;
  }
}

class NotebookMail {
  public constructor(
    private readonly client: Client,
    private readonly notebookId: string
  ) { }

  public async status(): Promise<NotebookMailStateData> {
    const response = await this.client.get<NotebookMailStateData>(`/notebook/${this.notebookId}/mail`);

    return response.data;
  }

  public async enable(): Promise<NotebookMailStateData> {
    const response = await this.client.put<NotebookMailStateData>(`/notebook/${this.notebookId}/mail`);

    return response.data;
  }

  public async disable(): Promise<void> {
    await this.client.delete<void>(`/notebook/${this.notebookId}/mail`);
  }

  public async list(options: NotebookMailListOptions = {}): Promise<PaginatedApiResponse<NotebookMailData>> {
    return this.client.get<NotebookMailData[]>(
      `/notebook/${this.notebookId}/mails${formatQueryString(options)}`
    );
  }

  public async get(hash: string): Promise<NotebookMailData> {
    const response = await this.client.get<NotebookMailData>(
      `/notebook/${this.notebookId}/mails/${encodeURIComponent(hash)}`
    );

    return response.data;
  }

  public async delete(hash: string): Promise<void> {
    await this.client.delete<void>(`/notebook/${this.notebookId}/mails/${encodeURIComponent(hash)}`);
  }
}

function formatQueryString(params: object): string {
  const searchParams = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      searchParams.set(key, String(value));
    }
  }

  const query = searchParams.toString();

  return query === '' ? '' : `?${query}`;
}
