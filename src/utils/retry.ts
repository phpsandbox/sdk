export interface RetryOptions {
  retries?: number;
  minTimeout?: number;
  maxTimeout?: number;
  factor?: number;
  randomize?: boolean;
  onRetry?: (error: unknown, attempt: number) => void | Promise<void>;
}

type RetryBail = (error?: unknown) => never;

class RetryBailError {
  public constructor(public readonly error: unknown) {}
}

const sleep = (duration: number): Promise<void> => {
  return new Promise((resolve) => {
    setTimeout(resolve, duration);
  });
};

const getRetryDelay = (attempt: number, options: Required<Omit<RetryOptions, 'onRetry'>>): number => {
  const randomized = options.randomize ? Math.random() + 1 : 1;
  const exponentialDelay = Math.max(options.minTimeout, 1) * Math.pow(options.factor, attempt - 1);

  return Math.round(Math.min(randomized * exponentialDelay, options.maxTimeout));
};

export async function retry<T>(
  fn: (bail: RetryBail, attempt: number) => T | Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const resolvedOptions: Required<Omit<RetryOptions, 'onRetry'>> = {
    retries: options.retries ?? 10,
    minTimeout: options.minTimeout ?? 1000,
    maxTimeout: options.maxTimeout ?? Infinity,
    factor: options.factor ?? 2,
    randomize: options.randomize ?? true,
  };

  const bail: RetryBail = (error?: unknown): never => {
    throw new RetryBailError(error ?? new Error('Aborted'));
  };

  let lastError: unknown;

  for (let attempt = 1; attempt <= resolvedOptions.retries + 1; attempt++) {
    try {
      return await fn(bail, attempt);
    } catch (error) {
      if (error instanceof RetryBailError) {
        throw error.error;
      }

      lastError = error;

      if (attempt > resolvedOptions.retries) {
        throw error;
      }

      await options.onRetry?.(error, attempt);
      await sleep(getRetryDelay(attempt, resolvedOptions));
    }
  }

  throw lastError;
}
