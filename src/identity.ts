import { z } from 'zod';

export const identitySchema = z.object({
  user: z.object({ id: z.string(), name: z.string() }).nullable(),
  organization: z.object({ id: z.string(), name: z.string() }),
  permissions: z.array(z.string()),
});

export type Identity = z.infer<typeof identitySchema>;
