import type { Client } from '../index.js';

export type IntegrationProvider = 'cloudflare' | 'github' | 'laravel-cloud';
export type IntegrationAuthorizationType = 'token';

export interface IntegrationAuthorization {
  type: IntegrationAuthorizationType;
  token: string;
}

export interface LinkIntegrationInput {
  provider: IntegrationProvider;
  label?: string | null;
  authorization: IntegrationAuthorization;
}

export interface UpdateIntegrationInput {
  label?: string | null;
  authorization?: IntegrationAuthorization;
}

export interface IntegrationData {
  id: string;
  provider: IntegrationProvider;
  label: string | null;
  createdAt: string | null;
}

export type IntegrationReference = string | Integration;

export class IntegrationApi {
  public constructor(private readonly client: Client) { }

  public async link(input: LinkIntegrationInput): Promise<Integration> {
    const response = await this.client.post<IntegrationData>('/integrations', input);

    return new Integration(response.data, this.client);
  }

  public async list(): Promise<Integration[]> {
    const response = await this.client.get<IntegrationData[]>('/integrations');

    return response.data.map((integration) => new Integration(integration, this.client));
  }

  public async get(integration: IntegrationReference): Promise<Integration> {
    const response = await this.client.get<IntegrationData>(`/integrations/${encodeURIComponent(integrationId(integration))}`);

    return new Integration(response.data, this.client);
  }

}

export class Integration {
  public constructor(
    public readonly data: IntegrationData,
    private readonly client: Client
  ) { }

  public get id(): string {
    return this.data.id;
  }

  public get provider(): IntegrationProvider {
    return this.data.provider;
  }

  public get label(): string | null {
    return this.data.label;
  }

  public async update(input: UpdateIntegrationInput): Promise<Integration> {
    const response = await this.client.patch<IntegrationData>(
      `/integrations/${encodeURIComponent(this.id)}`,
      input
    );

    return new Integration(response.data, this.client);
  }

  public async unlink(): Promise<void> {
    await this.client.delete<void>(`/integrations/${encodeURIComponent(this.id)}`);
  }
}

export function integrationId(integration: IntegrationReference): string {
  return typeof integration === 'string' ? integration : integration.id;
}
