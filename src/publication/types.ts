import type { LaravelCloudSetupState, LaravelCloudProviderData, LaravelCloudProviderInput } from './providers/laravel-cloud.js';
export type * from './providers/laravel-cloud.js';
import type {
  PublicationBuildStatus,
  PublicationJurisdiction,
  PublicationProtectionMode,
  PublicationRegion,
  PublicationReleaseStatus,
  PublicationSize,
  PublicationStatus,
} from '../schemas/publications.js';

export interface PublicationDestroyOptions {
  deleteResources?: boolean;
}

export interface PublicationPlacement {
  regions?: PublicationRegion[];
  jurisdiction?: PublicationJurisdiction;
}

export interface PublicationProtectionData {
  mode: PublicationProtectionMode;
  enabled: boolean;
  token?: string;
  expiresAt?: string;
  url?: string;
}

export type PublicationProtectionInput =
  | {
      mode: 'none';
      password?: never;
    }
  | {
      mode: 'password';
      password: string;
    };

export interface CloudflareContainersProviderOptions {
  accountId: string;
  size?: PublicationSize;
  sleepAfter?: string;
  placement?: PublicationPlacement;
  instances?: number;
}

export interface SshServerProviderOptions {
  serverId: string;
  resources?: Partial<Record<PublicationResourceKind, PublicationResourceSelection>>;
}

export type PublicationResourceKind = 'database' | 'cache' | 'storage' | 'worker' | 'scheduler';
export interface PublicationRequirement {
  kind: PublicationResourceKind;
  required?: boolean;
  recommended?: boolean;
  engine?: string;
  reason?: string;
}
export interface PublicationReadiness {
  repository: string | null;
  branch: string | null;
  sourceProvider: string | null;
  requirements: PublicationRequirement[];
  productionVariables: string[];
  missingVariables: string[];
  warnings: string[];
}
export type PublicationResourceMode = 'none' | 'create' | 'reuse' | 'external' | 'enable';

export interface PublicationResourceSelection {
  mode: PublicationResourceMode;
  id?: string;
  type?: string;
  version?: string;
  size?: string;
  config?: Record<string, string | number | boolean | null>;
}

export type PublicationPlanProviderInput<TName extends PublicationProviderName = PublicationProviderName> = {
  [Name in TName]: { name: Name } & Partial<PublicationProviderInputs[Name]>;
}[TName];

export interface PublicationPlanInput<TName extends PublicationProviderName = PublicationProviderName> {
  slug?: string;
  provider: PublicationPlanProviderInput<TName>;
  requirements?: PublicationRequirement[];
  resources?: Partial<Record<PublicationResourceKind, PublicationResourceSelection>>;
}

export type PlannedPublishInput = PublishInput & Pick<PublicationPlanInput, 'requirements' | 'resources'>;

export interface PublicationPlan<TName extends PublicationProviderName = PublicationProviderName> {
  provider: TName;
  capabilities: {
    source: 'git' | 'workspace';
    sourceProviders?: string[];
    resources: Record<PublicationResourceKind, PublicationResourceMode[]>;
  };
  readiness: PublicationReadiness;
  source: {
    type: 'git' | 'workspace';
    repository: string | null;
    branch: string | null;
    commitAndPush: boolean;
    providerAccess: 'verified' | 'confirmed' | 'confirmation_required' | 'not_required';
  };
  resources: Array<{
    kind: PublicationResourceKind;
    mode: PublicationResourceMode | 'unconfigured';
    engine: string | null;
    required: boolean;
    recommended: boolean;
    supported: boolean;
    selection: PublicationResourceSelection | boolean | null;
  }>;
  blockers: Array<{ code: string; message: string }>;
  ready: boolean;
  input: PublicationPlanInput<TName>;
  cost: { status: 'unknown'; message: string };
}
export interface PublicationDnsInstructions {
  stage: 'ownership' | 'traffic' | 'connected';
  records: PublicationDnsRecord[];
  trafficRecords: PublicationDnsRecord[];
}

export interface PublicationProviderInputs {
  'cloudflare-containers': CloudflareContainersProviderOptions;
  'ssh-server': SshServerProviderOptions;
  'laravel-cloud': LaravelCloudProviderInput;
}

export interface PublicationProviderData {
  'cloudflare-containers': CloudflareContainersProviderOptions;
  'ssh-server': SshServerProviderOptions;
  'laravel-cloud': LaravelCloudProviderData;
}

export type PublicationProviderName = Extract<keyof PublicationProviderInputs, string>;
export type PublicationProviderInput<TName extends PublicationProviderName = PublicationProviderName> = {
  [Name in TName]: { name: Name } & PublicationProviderInputs[Name];
}[TName];
export type PublicationProvider<TName extends PublicationProviderName = PublicationProviderName> = {
  [Name in TName]: { name: Name } & PublicationProviderData[Name];
}[TName];

export interface PublishInput<TName extends PublicationProviderName = PublicationProviderName> {
  slug: string;
  provider: PublicationProviderInput<TName>;
  protection?: PublicationProtectionInput;
  metadata?: Record<string, unknown>;
}

export interface PublicationBuildData<TProvider extends PublicationProviderName = PublicationProviderName> {
  id: string;
  status: PublicationBuildStatus;
  strategy: string;
  provider: PublicationProvider<TProvider>;
  errorMessage: string | null;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface PublicationReleaseData {
  id: string;
  status: PublicationReleaseStatus;
  manifest: Record<string, unknown>;
}

export interface PublicationData<TProvider extends PublicationProviderName = PublicationProviderName> {
  id: string;
  slug: string;
  url: string;
  status: PublicationStatus;
  strategy: string;
  provider: PublicationProvider<TProvider>;
  protection: PublicationProtectionData;
  eventStreamUrl: string | null;
  originUrl: string | null;
  domains?: PublicationDomainData[];
  setupState?: LaravelCloudSetupState | null;
  currentRelease?: PublicationReleaseData | null;
  latestBuild?: PublicationBuildData<TProvider> | null;
  deployedAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface UpdatePublicationProtectionInput {
  mode: PublicationProtectionMode;
  password?: string;
}

export interface PublicationProtectionSessionData {
  previewSessionId: string;
  token: string;
  expiresAt: string;
  url: string;
}

export interface PublicationDnsRecord {
  type: string;
  name: string;
  value: string;
  purpose?: 'ownership' | 'certificate' | 'traffic';
}

export interface PublicationDomainData {
  id: string;
  publicationId: string | null;
  hostname: string;
  status: string;
  provider: string;
  providerHostnameId: string | null;
  dns: { type: string | null; name: string | null; value: string | null };
  ssl: { status: string | null };
  dnsInstructions: PublicationDnsInstructions;
  validationErrors: unknown[];
  validationRecords: unknown[];
  metadata: Record<string, unknown>;
  verifiedAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface PublicationManagedResource {
  id: string;
  parentId: string | null;
  provider: PublicationProviderName;
  scope: string;
  providerId: string;
  kind: 'database' | 'cache' | 'storage';
  name: string;
  type: string | null;
  version: string | null;
  managed: boolean;
  status: 'pending' | 'provisioning' | 'available' | 'unknown' | 'retained' | 'deleting' | 'delete_failed' | 'deleted';
  attachments: PublicationResourceAttachment[];
  attachmentCount: number;
  createdAt: string;
}

export interface PublicationResourceListOptions {
  provider?: PublicationProviderName;
  kind?: PublicationManagedResource['kind'];
  type?: string;
  scope?: string;
  page?: number;
}

export interface PublicationResourceAttachment {
  notebookId: string | null;
  publicationId: string | null;
  detachedAt: string | null;
}
