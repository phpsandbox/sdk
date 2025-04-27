export type ErrorCode = 500 | 400 | 401 | 403 | 404 | 409 | 422 | 429 | 5000;

export class ErrorEvent {
  public constructor(
    public readonly code: ErrorCode,
    public readonly message: string,
    public readonly raw: object = {}
  ) {}
}

export interface Disposable {
  dispose: () => void;
}
