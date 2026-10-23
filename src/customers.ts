import { z } from 'zod';
import type { Client } from './index.js';

export const customerModeSchema = z.enum(['test', 'live']);
export type CustomerMode = z.infer<typeof customerModeSchema>;
export const customerSchema = z.object({
  id: z.string(),
  externalId: z.string(),
  email: z.string(),
  name: z.string().nullable(),
  source: z.string().nullable(),
  marketingSubscribed: z.boolean(),
  communicationBasis: z.enum(['unknown', 'legacy_account', 'explicit_opt_in', 'unsubscribed']).optional(),
  legacyPolicy: z.string().nullable().optional(),
  joinedAt: z.string().nullable().optional(),
  importedAt: z.string().nullable().optional(),
  lastActiveAt: z.string().nullable().optional(),
  billingStatus: z.enum(['unknown', 'free', 'paid']).optional(),
  suppressionReason: z.string().nullable(),
  activatedAt: z.string().nullable(),
  createdAt: z.string().nullable(),
});
export type CustomerData = z.infer<typeof customerSchema>;
const spaceSchema = z.object({
  id: z.string(),
  mode: customerModeSchema,
  enabled: z.boolean(),
  senderName: z.string().nullable(),
  senderEmail: z.string().nullable(),
  replyTo: z.string().nullable(),
  senderVerified: z.boolean(),
  domainRecords: z.string().nullable(),
  provisionedAt: z.string().nullable().optional(),
  lastRequestAt: z.string().nullable().optional(),
  processedAt: z.string().nullable().optional(),
});
export type CustomerSpaceData = z.infer<typeof spaceSchema>;
const journeyInputSchema = z.object({
  enabled: z.boolean(),
  subject: z.string(),
  body: z.string(),
  delayMinutes: z.number(),
  activationEvent: z.string(),
});
export type CustomerJourneyInput = z.infer<typeof journeyInputSchema>;
const journeySchema = journeyInputSchema.extend({
  kind: z.enum(['welcome', 'setup', 'purchase', 'credit_limit']),
  version: z.number().int().optional(),
  startsAt: z.string().nullable().optional(),
  draft: journeyInputSchema.nullable().optional(),
});
export type CustomerJourneyData = z.infer<typeof journeySchema>;
const messageSchema = z.object({
  id: z.string(),
  customerId: z.string().nullable(),
  recipient: z.string(),
  subject: z.string(),
  body: z.string(),
  status: z.string(),
  error: z.string().nullable(),
  dueAt: z.string().nullable().optional(),
  attemptedAt: z.string().nullable().optional(),
  receivedAt: z.string().nullable().optional(),
  journeyKind: z.enum(['welcome', 'setup', 'purchase', 'credit_limit']).nullable().optional(),
  journeyVersion: z.number().int().nullable().optional(),
  category: z.enum(['marketing', 'service']).optional(),
  from: z.string().nullable().optional(),
  replyTo: z.string().nullable().optional(),
  renderedText: z.string().nullable().optional(),
  unsubscribeUrl: z.string().nullable().optional(),
  createdAt: z.string().nullable(),
});
export type CustomerMessageData = z.infer<typeof messageSchema>;
const overviewSchema = z.object({
  conversion: z
    .object({
      usedAi: z.number(),
      reachedLimit: z.number(),
      qualified: z.number(),
      offerExposed: z.number(),
      checkoutStarted: z.number(),
      firstPayments: z.number(),
      resumedBuilding: z.number(),
      fullPriceRenewals: z.number(),
    })
    .optional(),
  space: spaceSchema.nullable(),
  customers: z.array(customerSchema),
  journeys: z.array(journeySchema),
  messages: z.array(messageSchema),
  total: z.number(),
  messageTotal: z.number().optional(),
  events: z.array(z.string()).optional(),
});
export type CustomersOverview = z.infer<typeof overviewSchema>;
export interface IdentifyCustomerInput {
  externalId: string;
  email: string;
  name?: string | null;
  source?: string;
  billingStatus?: 'unknown' | 'free' | 'paid';
  /** Original registration time, independent of the Customers record creation time. */
  joinedAt?: string;
  lastActiveAt?: string;
  /** Historical synchronization never enrolls signup journeys. */
  historical?: boolean;
  /** Explicit eligibility policy for accounts with unknown preferences; this does not record consent. */
  legacyPolicy?: string;
  /** Import known suppressions. Identification can never clear an existing suppression. */
  suppressionReason?: string;
  /** Preserve a known unsubscribe atomically during account identification. Never clears an unsubscribe. */
  unsubscribed?: true;
  /** Original known unsubscribe time. A later explicit opt-in remains authoritative. */
  unsubscribedAt?: string;
}
export interface CustomerEventInput {
  eventId: string;
  name: string;
  organizationExternalId?: string;
  occurredAt?: string;
  /** Preserve activity history without activating or enrolling a customer. */
  historical?: boolean;
  properties?: Record<string, string | number | boolean | null>;
}
export interface CustomerOrganizationInput {
  externalId: string;
  name: string;
  ownerExternalId: string;
  /** Complete current membership snapshot. The owner is always included. */
  members: { externalId: string; role: string }[];
}
export interface CustomerPaymentInput {
  paymentId: string;
  amountMinor: number;
  currency: string;
  paidAt: string;
  historical?: boolean;
}
const customerOrganizationSchema = z.object({
  id: z.string(),
  externalId: z.string(),
  name: z.string(),
  ownerCustomerId: z.string(),
  firstPaidAt: z.string().nullable(),
  activatedAt: z.string().nullable(),
});
export type CustomerOrganizationData = z.infer<typeof customerOrganizationSchema>;
export interface SendCustomerMessageInput {
  requestId: string;
  subject: string;
  body: string;
  category: 'service' | 'marketing';
}

/** Use only from trusted app servers with a dedicated Customers credential. */
export class CustomerRuntime {
  public constructor(private readonly client: Client) {}

  /** Inspect the workspace and environment selected by this app credential. */
  public async context(): Promise<{ id: string; notebookId: string; mode: CustomerMode }> {
    return z
      .object({ id: z.string(), notebookId: z.string(), mode: customerModeSchema })
      .parse((await this.client.get<unknown>('/platform/customers/runtime/context')).data);
  }

  /** Pull due conversion follow-ups, then recheck authoritative billing, credit and access. */
  public async pendingFollowUps(): Promise<{ messageId: string; organizationExternalId: string; actorExternalId: string }[]> {
    return z
      .array(z.object({ messageId: z.string(), organizationExternalId: z.string(), actorExternalId: z.string() }))
      .parse((await this.client.get<unknown>('/platform/customers/runtime/follow-ups')).data);
  }

  /** Eligible deliveries run immediately; expired checks are never reused by a later worker. */
  public async resolveFollowUp(
    messageId: string,
    resolution: 'eligible' | 'paid' | 'credits_available' | 'access_changed'
  ): Promise<CustomerMessageData> {
    return messageSchema.parse(
      (
        await this.client.post<unknown>(`/platform/customers/runtime/follow-ups/${encodeURIComponent(messageId)}/resolve`, {
          resolution,
        })
      ).data
    );
  }

  public async organization(input: CustomerOrganizationInput): Promise<CustomerOrganizationData> {
    return customerOrganizationSchema.parse(
      (await this.client.put<unknown>('/platform/customers/runtime/organizations', input)).data
    );
  }

  /** Report only server-confirmed positive payments from your existing billing integration. */
  public async confirmPayment(organizationExternalId: string, input: CustomerPaymentInput): Promise<CustomerOrganizationData> {
    return customerOrganizationSchema.parse(
      (
        await this.client.post<unknown>(
          `/platform/customers/runtime/organizations/${encodeURIComponent(organizationExternalId)}/payments`,
          input
        )
      ).data
    );
  }

  public async identify(input: IdentifyCustomerInput): Promise<CustomerData> {
    return customerSchema.parse((await this.client.post<unknown>('/platform/customers/runtime/identify', input)).data);
  }

  public async linkIdentity(customerId: string, externalId: string): Promise<CustomerData> {
    return customerSchema.parse(
      (
        await this.client.post<unknown>(`/platform/customers/runtime/${encodeURIComponent(customerId)}/identities`, {
          externalId,
        })
      ).data
    );
  }

  public async get(customerId: string): Promise<CustomerData> {
    return customerSchema.parse(
      (await this.client.get<unknown>(`/platform/customers/runtime/${encodeURIComponent(customerId)}`)).data
    );
  }

  public async event(customerId: string, input: CustomerEventInput): Promise<{ id: string; name: string }> {
    return z
      .object({ id: z.string(), name: z.string() })
      .parse(
        (await this.client.post<unknown>(`/platform/customers/runtime/${encodeURIComponent(customerId)}/events`, input)).data
      );
  }

  public async preferences(
    customerId: string,
    input: { subscribed: boolean; source: string; occurredAt?: string }
  ): Promise<CustomerData> {
    return customerSchema.parse(
      (await this.client.put<unknown>(`/platform/customers/runtime/${encodeURIComponent(customerId)}/preferences`, input)).data
    );
  }

  public async send(customerId: string, input: SendCustomerMessageInput): Promise<CustomerMessageData> {
    return messageSchema.parse(
      (await this.client.post<unknown>(`/platform/customers/runtime/${encodeURIComponent(customerId)}/messages`, input)).data
    );
  }
}

export class CustomersApi {
  public readonly runtime: CustomerRuntime;
  public constructor(private readonly client: Client) {
    this.runtime = new CustomerRuntime(client);
  }
  public forNotebook(notebookId: string): NotebookCustomers {
    return new NotebookCustomers(notebookId, this.client);
  }
}

export class NotebookCustomers {
  public constructor(
    private readonly notebookId: string,
    private readonly client: Client
  ) {}

  public async list(
    mode: CustomerMode = 'test',
    query: { search?: string; page?: number; messagePage?: number } = {}
  ): Promise<CustomersOverview> {
    return overviewSchema.parse(
      (
        await this.client.get<unknown>(
          `${this.path(mode)}?${new URLSearchParams(Object.entries(query).map(([key, value]) => [key, String(value)])).toString()}`
        )
      ).data
    );
  }

  public async connect(mode: CustomerMode = 'test'): Promise<CustomerSpaceData> {
    return spaceSchema.parse((await this.client.put<unknown>(this.path(mode), {})).data);
  }

  public async provision(mode: CustomerMode = 'test'): Promise<CustomerSpaceData> {
    return spaceSchema.parse((await this.client.post<unknown>(`${this.path(mode)}/provision`, {})).data);
  }

  public async disable(mode: CustomerMode = 'test'): Promise<CustomerSpaceData> {
    return spaceSchema.parse((await this.client.post<unknown>(`${this.path(mode)}/disable`, {})).data);
  }

  public async resume(mode: CustomerMode = 'test'): Promise<CustomerSpaceData> {
    return spaceSchema.parse((await this.client.post<unknown>(`${this.path(mode)}/resume`, {})).data);
  }

  public async rotate(mode: CustomerMode = 'test'): Promise<CustomerSpaceData> {
    return spaceSchema.parse((await this.client.post<unknown>(`${this.path(mode)}/rotate`, {})).data);
  }

  public async sender(
    input: { senderName: string; senderEmail: string; replyTo: string },
    mode: CustomerMode = 'test'
  ): Promise<CustomerSpaceData> {
    return spaceSchema.parse((await this.client.put<unknown>(`${this.path(mode)}/sender`, input)).data);
  }

  public async verifySender(mode: CustomerMode = 'test'): Promise<CustomerSpaceData> {
    return spaceSchema.parse((await this.client.post<unknown>(`${this.path(mode)}/sender/verify`, {})).data);
  }

  public async journey(
    kind: CustomerJourneyData['kind'],
    input: CustomerJourneyInput,
    mode: CustomerMode = 'test'
  ): Promise<CustomerJourneyData> {
    return journeySchema.parse((await this.client.put<unknown>(`${this.path(mode)}/journeys/${kind}`, input)).data);
  }

  private path(mode: CustomerMode): string {
    return `/platform/customers/sandboxes/${encodeURIComponent(this.notebookId)}/${mode}`;
  }
}
