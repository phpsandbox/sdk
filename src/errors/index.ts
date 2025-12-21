export class PromiseTimeoutError extends Error {
  public constructor(
    message: string,
    public time: number
  ) {
    super(message);
  }
}

export class SendTimeoutError extends PromiseTimeoutError {
    static fromPromiseTimeoutError(error: PromiseTimeoutError) {
        return new SendTimeoutError(error.message, error.time);
    }
}
