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

export interface Disposable {
  dispose: () => void;
}
