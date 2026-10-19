import { z } from 'zod';
import type { Client } from './index.js';

export const paymentModeSchema = z.enum(['test', 'live']);
export type PaymentMode = z.infer<typeof paymentModeSchema>;
const accountSchema = z.object({
  id: z.string(),
  mode: paymentModeSchema,
  chargesEnabled: z.boolean(),
  payoutsEnabled: z.boolean(),
  detailsSubmitted: z.boolean(),
  requirements: z.array(z.string()),
  disabledReason: z.string().nullable(),
});
export type PaymentAccountData = z.infer<typeof accountSchema>;
const accessSchema = z.object({
  subscribed: z.boolean(),
  liveAllowed: z.boolean(),
  testConfigured: z.boolean(),
  liveConfigured: z.boolean(),
  feeBasisPoints: z.number().int().min(0).max(10000).nullable(),
  canRead: z.boolean(),
  canManage: z.boolean(),
  canRefund: z.boolean(),
});
export type PaymentsAccess = z.infer<typeof accessSchema>;
const applicationsSchema = z.object({
  notebookId: z.string(),
  applications: z.array(
    z.object({
      id: z.string(),
      url: z.string().nullable(),
      healthy: z.boolean(),
      passwordProtected: z.boolean(),
      deployedAt: z.string().datetime().nullable(),
    })
  ),
});
export type PaymentApplicationsData = z.infer<typeof applicationsSchema>;
const bindingSchema = z.object({
  id: z.string(),
  notebookId: z.string(),
  applicationId: z.string().nullable(),
  mode: paymentModeSchema,
  revision: z.number().int(),
  accountId: z.string(),
  enabled: z.boolean(),
  callbackUrl: z.string().nullable(),
  originUrl: z.string().nullable(),
  runtimeConfigured: z.boolean(),
});
export type PaymentBindingData = z.infer<typeof bindingSchema>;
const priceSchema = z.object({
  id: z.string(),
  name: z.string(),
  amount: z.number().int(),
  currency: z.string(),
  bindingId: z.string(),
});
export type PaymentPriceData = z.infer<typeof priceSchema>;
const transactionSchema = z.object({
  id: z.string(),
  bindingId: z.string(),
  orderId: z.string(),
  priceId: z.string(),
  amount: z.number().int(),
  currency: z.string(),
  feeAmount: z.number().int(),
  revision: z.number().int(),
  refundedAmount: z.number().int(),
  status: z.enum(['pending', 'paid', 'failed', 'refunded', 'partially_refunded']),
  checkoutUrl: z.string().nullable(),
  deliveredAt: z.string().nullable(),
});
export type PaymentTransactionData = z.infer<typeof transactionSchema>;
const refundResultSchema = transactionSchema.extend({
  refund: z.object({
    id: z.string(),
    amount: z.number().int().positive(),
    status: z.enum(['pending', 'succeeded', 'failed', 'canceled', 'requires_action']),
  }),
});
export type PaymentRefundResult = z.infer<typeof refundResultSchema>;
const activationSchema = z.object({
  revision: z.number().int(),
  reviewId: z.string(),
  expiresAt: z.string(),
  blockers: z.array(z.string()),
  binding: bindingSchema,
  account: accountSchema,
  feeBasisPoints: z.number().int().nullable(),
  prices: z.array(priceSchema),
});
export type PaymentActivationReview = z.infer<typeof activationSchema>;
export interface ConfigurePaymentsInput {
  expectedRevision: number;
  applicationId?: string | null;
  callbackPath?: string;
}
export interface CreatePaymentPriceInput {
  requestId: string;
  name: string;
  amount: number;
  currency: string;
}
export interface CreatePaymentCheckoutInput {
  requestId: string;
  orderId: string;
  priceId: string;
  successPath: string;
  cancelPath: string;
}
export interface RefundPaymentInput {
  requestId: string;
  amount?: number;
}

export class PaymentsApi {
  public readonly runtime: PaymentRuntime;

  public constructor(private readonly client: Client) {
    this.runtime = new PaymentRuntime(client);
  }

  public forNotebook(notebookId: string): NotebookPayments {
    return new NotebookPayments(notebookId, this.client);
  }

  public async applications(notebookId: string): Promise<PaymentApplicationsData> {
    return applicationsSchema.parse(
      (await this.client.get<unknown>(`/notebook/${encodeURIComponent(notebookId)}/payments/applications`)).data
    );
  }

  public async access(): Promise<PaymentsAccess> {
    return accessSchema.parse((await this.client.get<unknown>('/platform/payments/access')).data);
  }

  public async accounts(): Promise<PaymentAccountData[]> {
    return z.array(accountSchema).parse((await this.client.get<unknown>('/platform/payments/accounts')).data);
  }

  public async createAccount(mode: PaymentMode, country?: string): Promise<PaymentAccountData> {
    return accountSchema.parse((await this.client.put<unknown>(`/platform/payments/accounts/${mode}`, { country })).data);
  }

  public async onboarding(mode: PaymentMode): Promise<{ url: string; expiresAt: string }> {
    return z
      .object({ url: z.string().url(), expiresAt: z.string() })
      .parse((await this.client.post<unknown>(`/platform/payments/accounts/${mode}/onboarding`, {})).data);
  }
}

export class NotebookPayments {
  public constructor(
    private readonly notebookId: string,
    private readonly client: Client
  ) {}

  private path(mode: PaymentMode): string {
    return `/platform/payments/sandboxes/${encodeURIComponent(this.notebookId)}/${mode}`;
  }

  public async get(mode: PaymentMode = 'test'): Promise<PaymentBindingData | null> {
    return bindingSchema.nullable().parse((await this.client.get<unknown>(this.path(mode))).data);
  }

  public async configure(input: ConfigurePaymentsInput, mode: PaymentMode = 'test'): Promise<PaymentBindingData> {
    return bindingSchema.parse((await this.client.put<unknown>(this.path(mode), input)).data);
  }

  public async provision(mode: PaymentMode = 'test'): Promise<PaymentBindingData> {
    return bindingSchema.parse((await this.client.post<unknown>(`${this.path(mode)}/provision`, {})).data);
  }

  public async prices(mode: PaymentMode = 'test'): Promise<PaymentPriceData[]> {
    return z.array(priceSchema).parse((await this.client.get<unknown>(`${this.path(mode)}/prices`)).data);
  }

  public async createPrice(input: CreatePaymentPriceInput, mode: PaymentMode = 'test'): Promise<PaymentPriceData> {
    return priceSchema.parse((await this.client.post<unknown>(`${this.path(mode)}/prices`, input)).data);
  }

  public async prepareActivation(mode: PaymentMode = 'test'): Promise<PaymentActivationReview> {
    return activationSchema.parse((await this.client.post<unknown>(`${this.path(mode)}/activation`, {})).data);
  }

  public async activate(reviewId: string, mode: PaymentMode = 'test'): Promise<PaymentBindingData> {
    return bindingSchema.parse((await this.client.post<unknown>(`${this.path(mode)}/activate`, { reviewId })).data);
  }

  public async disable(mode: PaymentMode = 'test'): Promise<PaymentBindingData> {
    return bindingSchema.parse((await this.client.post<unknown>(`${this.path(mode)}/disable`, {})).data);
  }

  public async checkout(input: CreatePaymentCheckoutInput, mode: PaymentMode = 'test'): Promise<PaymentTransactionData> {
    return transactionSchema.parse((await this.client.post<unknown>(`${this.path(mode)}/checkouts`, input)).data);
  }

  public async transactions(mode: PaymentMode = 'test'): Promise<PaymentTransactionData[]> {
    return z.array(transactionSchema).parse((await this.client.get<unknown>(`${this.path(mode)}/transactions`)).data);
  }

  public async refund(id: string, input: RefundPaymentInput, mode: PaymentMode = 'test'): Promise<PaymentRefundResult> {
    return refundResultSchema.parse(
      (await this.client.post<unknown>(`${this.path(mode)}/transactions/${encodeURIComponent(id)}/refund`, input)).data
    );
  }
}

const paymentEventSchema = z.object({
  id: z.string(),
  type: z.literal('payment.updated'),
  mode: paymentModeSchema,
  transaction: transactionSchema,
});
export type PaymentEvent = z.infer<typeof paymentEventSchema>;

/** Verify the original bytes before parsing JSON. Use only in trusted server code. */
export async function verifyPaymentEvent(
  body: string,
  signature: string,
  token: string,
  mode: PaymentMode,
  now = Date.now()
): Promise<PaymentEvent> {
  if (!/^hpay_[a-f0-9]{64}$/.test(token)) {
    throw new Error('Invalid application payment credential.');
  }
  const match = /^t=(\d+),v1=([a-f0-9]{64})$/.exec(signature);
  const timestamp = match?.[1];
  const digest = match?.[2];
  if (!timestamp || !digest || Math.abs(now - Number(timestamp) * 1000) > 300000 || body.length > 262144) {
    throw new Error('Invalid or expired payment signature.');
  }
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', encoder.encode(token), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
  const bytes = Uint8Array.from(digest.match(/../g) ?? [], (byte) => Number.parseInt(byte, 16));
  if (!(await crypto.subtle.verify('HMAC', key, bytes, encoder.encode(`${timestamp}.${body}`)))) {
    throw new Error('Invalid payment signature.');
  }
  const event = paymentEventSchema.parse(JSON.parse(body));
  if (event.mode !== mode) {
    throw new Error('Payment event mode does not match this application.');
  }
  return event;
}

export class PaymentRuntime {
  public constructor(private readonly client: Client) {}

  public async checkout(input: CreatePaymentCheckoutInput): Promise<PaymentTransactionData> {
    return transactionSchema.parse((await this.client.post<unknown>('/platform/payments/runtime/checkouts', input)).data);
  }

  public async transaction(id: string): Promise<PaymentTransactionData> {
    return transactionSchema.parse(
      (await this.client.get<unknown>(`/platform/payments/runtime/transactions/${encodeURIComponent(id)}`)).data
    );
  }

  public async prices(): Promise<PaymentPriceData[]> {
    return z.array(priceSchema).parse((await this.client.get<unknown>('/platform/payments/runtime/prices')).data);
  }
}
