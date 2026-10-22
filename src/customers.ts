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
  kind: z.enum(['welcome', 'setup', 'purchase']),
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
  journeyKind: z.enum(['welcome', 'setup', 'purchase']).nullable().optional(),
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
  name?: string;
  source?: string;
  billingStatus?: 'unknown' | 'free' | 'paid';
}
export interface CustomerEventInput {
  eventId: string;
  name: string;
  occurredAt?: string;
  properties?: Record<string, string | number | boolean | null>;
}
export interface SendCustomerMessageInput {
  requestId: string;
  subject: string;
  body: string;
  category: 'service' | 'marketing';
}

/** Use only from trusted app servers with a dedicated Customers credential. */
export class CustomerRuntime {
  public constructor(private readonly client: Client) {}

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

  public async preferences(customerId: string, input: { subscribed: boolean; source: string }): Promise<CustomerData> {
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
