import { z } from 'zod';

export const PublicationProviderNameSchema = z.enum([
  'cloudflare-containers',
  'ssh-server',
  'laravel-cloud',
]);

export const PublicationStatusSchema = z.enum([
  'pending',
  'queued',
  'building',
  'deploying',
  'healthy',
  'failed',
  'stopped',
  'deleting',
  'deleted',
  'delete_failed',
]);

export const PublicationBuildStatusSchema = z.enum([
  'pending',
  'queued',
  'running',
  'succeeded',
  'failed',
  'cancelled',
]);

export const PublicationReleaseStatusSchema = z.enum(['created', 'ready', 'deleted']);

export const PublicationSizeSchema = z.enum([
  'nano',
  'small',
  'medium',
  'large',
  'lite',
  'basic',
  'standard-1',
  'standard-2',
]);

export const PublicationRegionSchema = z.enum([
  'ENAM',
  'WNAM',
  'EEUR',
  'WEUR',
  'APAC',
  'SAM',
  'ME',
  'OC',
  'AFR',
]);

export const PublicationJurisdictionSchema = z.enum(['eu', 'fedramp']);
export const PublicationProtectionModeSchema = z.enum(['none', 'password']);
export const PublicationLogStreamSchema = z.enum(['build', 'runtime']);
export const PublishStreamLogStreamSchema = z.enum(['build', 'publish', 'runtime']);

const PublicationEventPayloadSchema = z.preprocess(
  (payload) => Array.isArray(payload) && payload.length === 0 ? {} : payload,
  z.record(z.string(), z.unknown()),
);

export const PublicationEventDataSchema = z.object({
  id: z.union([z.number(), z.string()]).optional(),
  sequence: z.number(),
  type: z.string(),
  payload: PublicationEventPayloadSchema,
  createdAt: z.string().nullable(),
}).passthrough();

export const PublicationLogChunkDataSchema = z.object({
  sequence: z.number(),
  stream: PublicationLogStreamSchema,
  content: z.string(),
  createdAt: z.string().nullable(),
}).passthrough();

export const PublishStreamPhaseSchema = z.object({
  name: z.string(),
  status: z.enum(['running', 'completed', 'failed']).optional(),
  data: z.record(z.string(), z.unknown()).optional(),
}).strict();

export const PublishStreamLogSchema = z.object({
  stream: PublishStreamLogStreamSchema,
  content: z.string(),
}).strict();

export const PublishStreamResultSchema = z.object({
  success: z.boolean(),
  publicationId: z.string(),
  url: z.string().url(),
  buildId: z.string(),
  releaseId: z.string(),
  status: PublicationStatusSchema,
}).strict();

export const PublishStreamPhaseEventSchema = PublishStreamPhaseSchema.extend({
  type: z.literal('phase'),
}).strict();

export const PublishStreamLogEventSchema = PublishStreamLogSchema.extend({
  type: z.literal('log'),
}).strict();

export const PublishStreamResultEventSchema = PublishStreamResultSchema.extend({
  type: z.literal('result'),
}).strict();

export const PublishStreamEventSchema = z.discriminatedUnion('type', [
  PublishStreamPhaseEventSchema,
  PublishStreamLogEventSchema,
  PublishStreamResultEventSchema,
]);

export const PublishStreamErrorSchema = z.object({
  message: z.string().optional(),
}).passthrough();

export const PublishStreamSseEventNameSchema = z.enum(['phase', 'log', 'done', 'result', 'error']);

export const PublishStreamSsePhaseEventSchema = z.object({
  event: z.literal('phase'),
  data: PublishStreamPhaseSchema,
}).strict();

export const PublishStreamSseLogEventSchema = z.object({
  event: z.literal('log'),
  data: PublishStreamLogSchema,
}).strict();

export const PublishStreamSseDoneEventSchema = z.object({
  event: z.literal('done'),
  data: PublishStreamResultSchema,
}).strict();

export const PublishStreamSseResultEventSchema = z.object({
  event: z.literal('result'),
  data: PublishStreamResultSchema,
}).strict();

export const PublishStreamSseErrorEventSchema = z.object({
  event: z.literal('error'),
  data: PublishStreamErrorSchema,
}).strict();

export const PublishStreamSseEventSchema = z.discriminatedUnion('event', [
  PublishStreamSsePhaseEventSchema,
  PublishStreamSseLogEventSchema,
  PublishStreamSseDoneEventSchema,
  PublishStreamSseResultEventSchema,
  PublishStreamSseErrorEventSchema,
]).transform((event) => {
  if (event.event === 'error') {
    throw new Error(event.data.message ?? 'Publish failed');
  }

  const type = event.event === 'done' ? 'result' : event.event;
  return PublishStreamEventSchema.parse({ type, ...event.data });
});

export type BuiltInPublicationProviderName = z.infer<typeof PublicationProviderNameSchema>;
export type PublicationStatus = z.infer<typeof PublicationStatusSchema>;
export type PublicationBuildStatus = z.infer<typeof PublicationBuildStatusSchema>;
export type PublicationReleaseStatus = z.infer<typeof PublicationReleaseStatusSchema>;
export type PublicationSize = z.infer<typeof PublicationSizeSchema>;
export type PublicationRegion = z.infer<typeof PublicationRegionSchema>;
export type PublicationJurisdiction = z.infer<typeof PublicationJurisdictionSchema>;
export type PublicationProtectionMode = z.infer<typeof PublicationProtectionModeSchema>;
export type PublicationLogStream = z.infer<typeof PublicationLogStreamSchema>;
export type PublicationEventData = z.infer<typeof PublicationEventDataSchema>;
export type PublicationLogChunkData = z.infer<typeof PublicationLogChunkDataSchema>;
export type PublishStreamPhase = z.infer<typeof PublishStreamPhaseSchema>;
export type PublishStreamLog = z.infer<typeof PublishStreamLogSchema>;
export type PublishStreamResult = z.infer<typeof PublishStreamResultSchema>;
export type PublishStreamEvent = z.infer<typeof PublishStreamEventSchema>;
export type PublishStreamSseEvent = z.infer<typeof PublishStreamSseEventSchema>;
