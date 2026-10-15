import { z } from 'zod';
import type { Client } from './index.js';
import { PHPSandboxError } from './errors/index.js';

const platformAccessSchema = z.object({
  organizationId: z.string(),
  actorId: z.string().nullable(),
  permissions: z.array(z.string()),
});

export type PlatformAccess = z.infer<typeof platformAccessSchema>;

export class PlatformApi {
  constructor(private readonly client: Client) {}

  async access(): Promise<PlatformAccess> {
    const { data } = await this.client.get<unknown>('/auth/access');
    const result = platformAccessSchema.safeParse(data);
    if (!result.success) {
      throw new PHPSandboxError('Invalid platform access response.');
    }

    return result.data;
  }
}
