import { z } from 'zod';

export const identitySchema = z.object({
  organizationId: z.string(),
  userId: z.string().nullable(),
  permissions: z.array(z.string()),
});

export type Identity = z.infer<typeof identitySchema>;
