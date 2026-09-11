export type RemoteErrorSource = 'core' | 'runtime';

const remoteErrorCodes = [
  'ActionNotFound',
  'AuthenticationRequired',
  'BadGateway',
  'BadRequest',
  'Conflict',
  'FileAlreadyExists',
  'FileIsDirectory',
  'FileNotDirectory',
  'FileNotFound',
  'FilesystemUnavailable',
  'InternalError',
  'InvalidArgument',
  'InvalidConfiguration',
  'InvalidRequest',
  'InvalidResponse',
  'InvalidServiceCommand',
  'MethodNotAllowed',
  'NotebookInitializationFailed',
  'NotebookUnavailable',
  'NotFound',
  'PayloadTooLarge',
  'PermissionDenied',
  'RateLimited',
  'RequestFailed',
  'RuntimeOperationFailed',
  'ServiceNotFound',
  'ServiceUnavailable',
  'UnprocessableEntity',
  'ValidationFailed',
  'WorkspaceUnavailable',
] as const;

export type RemoteErrorCode = typeof remoteErrorCodes[number];

export type TransportErrorCode =
  | 'ConnectionFailed'
  | 'ConnectionTimeout'
  | 'InvalidResponse'
  | 'SendTimeout';

export interface ValidationErrorDetails {
  errors: Record<string, string[]>;
}

export interface RemoteErrorOptions<TCode extends RemoteErrorCode = RemoteErrorCode, TDetails = unknown> {
  source: RemoteErrorSource;
  status: number;
  code: TCode;
  details?: TDetails;
  cause?: unknown;
}

export class PHPSandboxError extends Error {
  public readonly cause?: unknown;

  public constructor(message: string, cause?: unknown) {
    super(message);
    this.name = new.target.name;
    this.cause = cause;
  }
}

export class RemoteError<
  TCode extends RemoteErrorCode = RemoteErrorCode,
  TDetails = unknown,
> extends PHPSandboxError {
  public readonly source: RemoteErrorSource;
  public readonly status: number;
  public readonly code: TCode;
  public readonly details: TDetails | undefined;

  public constructor(message: string, options: RemoteErrorOptions<TCode, TDetails>) {
    super(message, options.cause);
    this.source = options.source;
    this.status = options.status;
    this.code = options.code;
    this.details = options.details;
  }

  public static is(error: unknown): error is RemoteError;
  public static is<TCode extends RemoteErrorCode>(error: unknown, code: TCode): error is RemoteError<TCode>;
  public static is(error: unknown, code?: RemoteErrorCode): error is RemoteError {
    return error instanceof RemoteError && (code === undefined || error.code === code);
  }

  public static isValidation(
    error: unknown
  ): error is RemoteError<'ValidationFailed', ValidationErrorDetails> & { readonly details: ValidationErrorDetails } {
    return RemoteError.is(error, 'ValidationFailed') && validationDetails(error.details) !== undefined;
  }

  public is<TExpectedCode extends RemoteErrorCode>(
    code: TExpectedCode
  ): this is this & RemoteError<TExpectedCode> {
    return (this.code as RemoteErrorCode) === code;
  }
}

export class TransportError<TCode extends TransportErrorCode = TransportErrorCode> extends PHPSandboxError {
  public constructor(
    message: string,
    public readonly code: TCode,
    cause?: unknown
  ) {
    super(message, cause);
  }

  public static is(error: unknown): error is TransportError;
  public static is<TCode extends TransportErrorCode>(error: unknown, code: TCode): error is TransportError<TCode>;
  public static is(error: unknown, code?: TransportErrorCode): error is TransportError {
    return error instanceof TransportError && (code === undefined || error.code === code);
  }

  public is<TExpectedCode extends TransportErrorCode>(
    code: TExpectedCode
  ): this is this & TransportError<TExpectedCode> {
    return (this.code as TransportErrorCode) === code;
  }
}

export function remoteError(
  source: RemoteErrorSource,
  payload: unknown,
  cause?: unknown
): RemoteError {
  const error = record(payload);
  const status = positiveInteger(error?.status);
  const code = nonEmptyString(error?.code);
  const message = nonEmptyString(error?.message);

  if (status === undefined || !isRemoteErrorCode(code) || message === undefined) {
    throw new TransportError('PHPSandbox returned an invalid error response.', 'InvalidResponse', cause ?? payload);
  }

  return new RemoteError(message, {
    source,
    status,
    code,
    details: error?.details,
    cause,
  });
}

function isRemoteErrorCode(value: unknown): value is RemoteErrorCode {
  return typeof value === 'string' && (remoteErrorCodes as readonly string[]).includes(value);
}

function positiveInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : undefined;
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function stringArrayRecord(value: unknown): Record<string, string[]> | undefined {
  const candidate = record(value);
  if (candidate === undefined) {
    return undefined;
  }

  const entries = Object.entries(candidate);
  if (!entries.every(([, messages]) => Array.isArray(messages) && messages.every((message) => typeof message === 'string'))) {
    return undefined;
  }

  return Object.fromEntries(entries) as Record<string, string[]>;
}

function validationDetails(value: unknown): ValidationErrorDetails | undefined {
  const details = record(value);
  const errors = stringArrayRecord(details?.errors);
  return errors === undefined ? undefined : { errors };
}

export class PromiseTimeoutError extends Error {
  public constructor(
    message: string,
    public time: number
  ) {
    super(message);
  }
}

export class SendTimeoutError extends TransportError<'SendTimeout'> {
  static fromPromiseTimeoutError(error: PromiseTimeoutError) {
    return new SendTimeoutError(error.message, error.time, error);
  }

  public constructor(
    message: string,
    public readonly time: number,
    cause?: unknown
  ) {
    super(message, 'SendTimeout', cause);
  }
}
