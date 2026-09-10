import type { Client, PaginatedApiResponse } from './index.js';

export interface ServerData {
  id: string;
  name: string;
  host: string;
  provider: string;
  status: string;
  token?: string;
  sshPublicKey?: string;
  installCommand?: string;
  connectedAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
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
  public constructor(private readonly client: Client) {}

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
      await new Promise(resolve => setTimeout(resolve, interval));
    }

    throw new Error(`Server did not become ready within ${timeout}ms`);
  }
}
