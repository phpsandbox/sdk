export type ErrorCode = 500 | 400 | 401 | 403 | 404 | 409 | 422 | 429 | 5000;

export class ErrorEvent extends Error {
  public constructor(
    public readonly code: ErrorCode,
    public readonly message: string,
    public readonly raw: object = {}
  ) {
    super(message);
  }
}

export class RateLimitError extends ErrorEvent {
  public constructor(message: string, raw: object = {}) {
    super(429, message, raw);
  }
}

export class PHPSandboxError extends ErrorEvent {}

export interface Disposable {
  dispose: () => void;
}
