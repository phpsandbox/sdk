import type { Client } from './index.js';
import { PHPSandboxError } from './errors/index.js';

export interface PlatformAccess {
  organizationId: string;
  actorId: string | null;
  permissions: string[];
}

export class PlatformApi {
  constructor(private readonly client: Client) {}

  async access(): Promise<PlatformAccess> {
    const { data } = await this.client.get<unknown>('/auth/access');
    if (
      typeof data !== 'object' ||
      data === null ||
      !('organizationId' in data) ||
      typeof data.organizationId !== 'string' ||
      !('actorId' in data) ||
      (data.actorId !== null && typeof data.actorId !== 'string') ||
      !('permissions' in data) ||
      !Array.isArray(data.permissions) ||
      !data.permissions.every((permission: unknown) => typeof permission === 'string')
    ) {
      throw new PHPSandboxError('Invalid platform access response.');
    }
    const permissions: string[] = [];
    for (const permission of data.permissions) {
      if (typeof permission === 'string') {
        permissions.push(permission);
      }
    }
    return { organizationId: data.organizationId, actorId: data.actorId, permissions };
  }
}
