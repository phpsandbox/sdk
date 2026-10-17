import type { Client, PaginatedApiResponse } from './index.js';
import { PHPSandboxError } from './errors/index.js';

export interface ServerData {
  id: string;
  name: string;
  host: string;
  provider: string;
  status: string;
  access: 'owner' | 'deployer';
  token?: string;
  sshPublicKey?: string;
  installCommand?: string;
  connectedAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface ServerMemberData {
  organizationId?: string | null;
  id: number;
  name: string;
  email: string;
  access: 'deployer';
}

export interface ServerInvitationData {
  recipientOrganizationId?: string | null;
  id: string;
  serverId: string;
  serverName: string;
  email: string;
  status: 'pending' | 'accepting' | 'accepted' | 'declined' | 'cancelled' | 'expired';
  expiresAt: string;
  createdAt: string;
}

export class ServerInvitationApi {
  public constructor(private readonly client: Client) {}

  public async inspect(id: string, token: string): Promise<ServerInvitationData> {
    return (
      await this.client.platformPost<ServerInvitationData>(`/server-invitations/${encodeURIComponent(id)}/inspect`, { token })
    ).data;
  }

  public async accept(id: string, token: string): Promise<ServerInvitationData> {
    return (
      await this.client.platformPost<ServerInvitationData>(`/server-invitations/${encodeURIComponent(id)}/accept`, { token })
    ).data;
  }

  public async decline(id: string, token: string): Promise<ServerInvitationData> {
    return (
      await this.client.platformPost<ServerInvitationData>(`/server-invitations/${encodeURIComponent(id)}/decline`, { token })
    ).data;
  }
}

export interface ServerSshOptions {
  user?: string;
  port?: number;
}

export interface CreateServerInput {
  name: string;
  host: string;
  ssh?: ServerSshOptions;
}

export interface ServerListOptions {
  page?: number;
}

export class ServerApi {
  public readonly invitations: ServerInvitationApi;

  public constructor(private readonly client: Client) {
    this.invitations = new ServerInvitationApi(client);
  }

  public async list(options: ServerListOptions = {}): Promise<PaginatedApiResponse<ServerData>> {
    const query = options.page === undefined ? '' : `?${new URLSearchParams({ page: String(options.page) }).toString()}`;
    return this.client.get<ServerData[]>(`/servers${query}`);
  }

  public async create(input: CreateServerInput): Promise<ServerInstance> {
    const response = await this.client.post<ServerData>('/servers', input);
    return new ServerInstance(response.data, this.client);
  }

  public async get(id: string): Promise<ServerInstance> {
    const response = await this.client.get<ServerData>(`/servers/${id}`);
    return new ServerInstance(response.data, this.client);
  }
}

export class ServerInstance {
  public constructor(
    public readonly data: ServerData,
    private readonly client: Client
  ) {}

  public async installation(): Promise<{ installCommand: string }> {
    return (await this.client.get<{ installCommand: string }>(`/servers/${encodeURIComponent(this.data.id)}/installation`)).data;
  }

  public async members(options: ServerListOptions = {}): Promise<PaginatedApiResponse<ServerMemberData>> {
    const query = options.page === undefined ? '' : `?${new URLSearchParams({ page: String(options.page) }).toString()}`;
    return this.client.get<ServerMemberData[]>(`/servers/${encodeURIComponent(this.data.id)}/members${query}`);
  }

  public async share(email: string): Promise<ServerMemberData> {
    return (await this.client.post<ServerMemberData>(`/servers/${encodeURIComponent(this.data.id)}/members`, { email })).data;
  }

  public async shareWithOrganization(organizationId: string, options: { requestId?: string } = {}): Promise<ServerMemberData> {
    return (
      await this.client.post<ServerMemberData>(`/servers/${encodeURIComponent(this.data.id)}/members`, {
        organizationId,
        ...options,
      })
    ).data;
  }

  public async revokeAccess(memberId: number): Promise<void> {
    await this.client.delete<{ deleted: boolean }>(
      `/servers/${encodeURIComponent(this.data.id)}/members/${encodeURIComponent(String(memberId))}`
    );
  }

  public async invite(email: string, options: { requestId?: string } = {}): Promise<ServerInvitationData> {
    return (
      await this.client.platformPost<ServerInvitationData>(`/servers/${encodeURIComponent(this.data.id)}/invitations`, {
        email,
        requestId: options.requestId ?? crypto.randomUUID(),
      })
    ).data;
  }

  public async invitations(options: ServerListOptions = {}): Promise<PaginatedApiResponse<ServerInvitationData>> {
    const query = options.page === undefined ? '' : `?${new URLSearchParams({ page: String(options.page) }).toString()}`;
    return this.client.platformGet<ServerInvitationData[]>(`/servers/${encodeURIComponent(this.data.id)}/invitations${query}`);
  }

  public async cancelInvitation(id: string): Promise<ServerInvitationData> {
    const response = await this.client.platformDelete<ServerInvitationData>(
      `/servers/${encodeURIComponent(this.data.id)}/invitations/${encodeURIComponent(id)}`
    );
    if (response.data === undefined) {
      throw new PHPSandboxError('Missing invitation cancellation response.');
    }

    return response.data;
  }

  public async resendInvitation(id: string): Promise<ServerInvitationData> {
    return (
      await this.client.platformPost<ServerInvitationData>(
        `/servers/${encodeURIComponent(this.data.id)}/invitations/${encodeURIComponent(id)}/resend`,
        {}
      )
    ).data;
  }

  public refresh(): Promise<ServerInstance> {
    return this.client.servers.get(this.data.id);
  }

  public async delete(): Promise<void> {
    await this.client.delete<{ deleted: boolean }>(`/servers/${this.data.id}`);
  }

  public async waitReady(options?: { timeout?: number; interval?: number }): Promise<ServerInstance> {
    const timeout = options?.timeout ?? 300_000; // 5 minutes default
    const interval = options?.interval ?? 3_000; // poll every 3s
    const deadline = Date.now() + timeout;

    while (Date.now() < deadline) {
      const server = await this.refresh();
      if (server.data.status === 'connected') {
        return server;
      }
      if (server.data.status === 'failed') {
        throw new Error(`Server provisioning failed: ${server.data.id}`);
      }
      await new Promise((resolve) => setTimeout(resolve, interval));
    }

    throw new Error(`Server did not become ready within ${timeout}ms`);
  }
}
