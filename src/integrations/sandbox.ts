import type { Client } from '../index.js';
import {
  Integration,
  integrationId,
  type IntegrationData,
  type IntegrationReference,
} from './account.js';

export type SandboxIntegrationEffect = 'network';

export interface AttachSandboxIntegrationInput {
  integration: IntegrationReference;
  effects?: SandboxIntegrationEffect[];
}

export type UpdateSandboxIntegrationInput =
  | { integration: IntegrationReference; effects?: SandboxIntegrationEffect[] }
  | { integration?: IntegrationReference; effects: SandboxIntegrationEffect[] };

export interface SandboxIntegrationData {
  id: string;
  integration: IntegrationData;
  effects: SandboxIntegrationEffect[];
}

export type SandboxIntegrationReference = string | SandboxIntegration;

export class SandboxIntegrationApi {
  public constructor(
    private readonly notebookId: string,
    private readonly client: Client
  ) { }

  public async attach(input: AttachSandboxIntegrationInput): Promise<SandboxIntegration> {
    const response = await this.client.post<SandboxIntegrationData>(this.path(), {
      ...input,
      integration: integrationId(input.integration),
    });

    return new SandboxIntegration(response.data, this.notebookId, this.client);
  }

  public async list(): Promise<SandboxIntegration[]> {
    const response = await this.client.get<SandboxIntegrationData[]>(this.path());

    return response.data.map((integration) => new SandboxIntegration(integration, this.notebookId, this.client));
  }

  public async get(integration: SandboxIntegrationReference): Promise<SandboxIntegration> {
    const response = await this.client.get<SandboxIntegrationData>(this.bindingPath(integration));

    return new SandboxIntegration(response.data, this.notebookId, this.client);
  }

  private path(): string {
    return `/notebook/${this.notebookId}/integrations`;
  }

  private bindingPath(integration: SandboxIntegrationReference): string {
    return `${this.path()}/${encodeURIComponent(sandboxIntegrationId(integration))}`;
  }
}

export class SandboxIntegration {
  public constructor(
    public readonly data: SandboxIntegrationData,
    private readonly notebookId: string,
    private readonly client: Client
  ) { }

  public get id(): string {
    return this.data.id;
  }

  public get integration(): Integration {
    return new Integration(this.data.integration, this.client);
  }

  public get effects(): SandboxIntegrationEffect[] {
    return this.data.effects;
  }

  public async update(input: UpdateSandboxIntegrationInput): Promise<SandboxIntegration> {
    const response = await this.client.patch<SandboxIntegrationData>(this.path(), {
      ...input,
      integration: input.integration === undefined ? undefined : integrationId(input.integration),
    });

    return new SandboxIntegration(response.data, this.notebookId, this.client);
  }

  public async detach(): Promise<void> {
    await this.client.delete<void>(this.path());
  }

  private path(): string {
    return `/notebook/${this.notebookId}/integrations/${encodeURIComponent(this.id)}`;
  }
}

export function sandboxIntegrationId(integration: SandboxIntegrationReference): string {
  return typeof integration === 'string' ? integration : integration.id;
}
