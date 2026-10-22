import type { Client } from './index.js';
import { CustomerRuntime } from './customers.js';
import { PaymentRuntime, type PaymentMode } from './payments.js';

export interface AppRuntimeOptions {
  /** Defaults to live in production and test otherwise. There is no fallback between modes. */
  mode?: PaymentMode;
  /** Supply server bindings explicitly on runtimes without process.env. */
  env?: Record<string, string | undefined>;
}

export function resolveAppConfiguration(options: AppRuntimeOptions) {
  if (typeof window !== 'undefined' && typeof document !== 'undefined') {
    throw new Error('Application credentials must only be used on a trusted server.');
  }
  const environment = options.env ?? (typeof process === 'undefined' ? {} : process.env);
  const mode = options.mode ?? (environment.NODE_ENV === 'production' ? 'live' : 'test');
  const token = environment[`PHPSANDBOX_APP_${mode.toUpperCase()}_TOKEN`];
  const url = environment.PHPSANDBOX_APP_API_URL;
  if (!token || !/^happ_[a-f0-9]{64}$/.test(token) || !url) {
    throw new Error(
      `Connect your app's ${mode === 'live' ? 'production' : 'development'} platform environment before using Customers or Payments.`
    );
  }
  return { mode, token, url };
}

/** Scoped app-server APIs. Organization and workspace management are deliberately excluded. */
export class AppRuntime {
  public readonly customers: CustomerRuntime;
  public readonly payments: PaymentRuntime;

  public constructor(
    client: Client,
    token: string,
    public readonly mode: PaymentMode
  ) {
    this.customers = new CustomerRuntime(client);
    this.payments = new PaymentRuntime(client, { token, mode });
  }
}
