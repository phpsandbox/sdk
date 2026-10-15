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
  supported?: boolean;
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
  resources?: Partial<Record<PublicationResourceKind, PublicationResourceSelection>>;
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
  revision?: string | null;
  sourceProvider: string | null;
  requirements: PublicationRequirement[];
  productionVariables: string[];
  missingVariables: string[];
  warnings: string[];
  configuration?: PublicationConfigurationField[];
  defaultBuild?: 'laravel' | 'dockerfile' | 'unresolved' | null;
}
export interface PublicationConfigurationField {
  name: string;
  requirement: 'required' | 'optional' | 'platform';
  source: string;
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

export interface PublicationAccessCapabilities {
  routing: 'platform' | 'provider';
  protection: boolean;
  feedback: boolean;
}

export interface PublicationCapabilities {
  source: 'git' | 'workspace';
  sourceProviders?: string[];
  buildModes?: Array<PublicationAppBuild['mode']>;
  appKinds?: Array<'http'>;
  resourceCleanup?: boolean;
  resources: Record<PublicationResourceKind, PublicationResourceMode[]>;
  access: { managed: PublicationAccessCapabilities; custom: PublicationAccessCapabilities };
}

export interface PublicationCatalogConfigField {
  name: string;
  type: string;
  required: boolean;
  label?: string;
  nullable?: boolean;
  description?: string;
  min?: number;
  max?: number;
  enum?: Array<string | number>;
  example?: string | number;
}

export interface PublicationCatalogResourceType {
  kind: PublicationResourceKind;
  type: string;
  label: string;
  versions: string[];
  regions: string[];
  sizes: { id: string; label: string }[];
  configFields: PublicationCatalogConfigField[];
}

export interface PublicationResourceCatalog {
  accounts?: { id: string; name: string }[];
  provider: PublicationProviderName;
  scope: string | null;
  capabilities: PublicationCapabilities;
  regions: { id: string; label: string; flag?: string }[];
  resourceTypes: PublicationCatalogResourceType[];
  resources: {
    id: string;
    name: string;
    kind: PublicationResourceKind;
    type: string | null;
    version: string | null;
    region: string | null;
    status: string;
  }[];
  pricingUrl: string | null;
}

export type PublicationDockerfile =
  | { source: 'generated'; content: string }
  | { source: 'project'; path: string };
export type PublicationContainerBuild = {
  mode: 'dockerfile';
  workingDirectory?: string;
  context?: string;
  dockerfile: PublicationDockerfile;
  target?: string;
  arguments?: Record<string, string>;
  secrets?: string[];
};
export type PublicationNativeBuild = {
  mode: 'provider-native';
  installCommand?: string;
  buildCommand?: string;
  deployCommand?: string;
};
export type PublicationAppBuild = PublicationContainerBuild | PublicationNativeBuild;
export type PublicationRoutingDraft =
  | { mode: 'managed'; routes?: never }
  | { mode: 'custom'; routes: [{ hostname: string }, ...Array<{ hostname: string }>] };
export interface PublicationManagedAddress { slug: string; url: string }
export type PublicationRouting = PublicationRoutingDraft & { managedAddress: PublicationManagedAddress };
export type PublicationContainerRuntime = {
  mode: 'container'; port: number; healthCheck: { path: string }; command?: string[];
};
export type PublicationNativeRuntime = { mode: 'provider-native'; port?: never; command?: never; healthCheck?: never };
interface PublicationAppDraftBase {
  name: string;
  kind: 'http';
  root: string;
  slug?: string;
  routing: PublicationRoutingDraft;
  resourceIds?: string[];
}
/** Only executable HTTP workloads are accepted. Runtime and build follow the destination. */
export type PublicationAppDraft = PublicationAppDraftBase & (
  | {
      destination: { provider: 'ssh-server'; serverId?: string };
      build: PublicationContainerBuild;
      runtime: PublicationContainerRuntime;
    }
  | {
      destination: { provider: 'cloudflare-containers' } & Partial<Omit<CloudflareContainersProviderOptions, 'resources'>>;
      build: Omit<PublicationContainerBuild, 'target' | 'arguments' | 'secrets'>;
      runtime: PublicationContainerRuntime;
    }
  | {
      destination: {
        provider: 'laravel-cloud'; region?: LaravelCloudProviderInput['region'];
        setup?: Pick<NonNullable<LaravelCloudProviderInput['setup']>, 'repositoryAccessConfirmed' | 'workerPlacement' | 'workerSize'>;
      };
      build: PublicationNativeBuild;
      runtime: PublicationNativeRuntime;
    }
);
/** Server-issued ID and managed address remain stable through names and app-count changes. */
export type PublicationApp = PublicationAppDraft extends infer Draft
  ? Draft extends PublicationAppDraft
    ? Omit<Draft, 'slug' | 'routing' | 'resourceIds'> & { id: string; routing: PublicationRouting; resourceIds: string[] }
    : never
  : never;
export type PublicationApplicationResourceInput = {
  id: string; kind: PublicationResourceKind; engine?: string; provider?: PublicationProviderName;
} & (
  | { mode: 'none' | 'external' | 'enable'; selection?: never }
  | { mode: 'reuse'; selection: { id: string } }
  | { mode: 'create'; provider: 'laravel-cloud'; kind: 'storage'; selection?: never }
  | { mode: 'create'; selection: { type: string; version?: string; size?: string; config?: Record<string, string | number | boolean | null> } }
);
export type PublicationConfigurationOperation =
  | { op: 'add-app'; app: PublicationAppDraft; adoptPublicationId?: string }
  | { op: 'update-app'; appId: string; app: PublicationAppDraft }
  | { op: 'remove-app'; appId: string }
  | { op: 'add-resource'; resource: PublicationApplicationResourceInput }
  | { op: 'update-resource'; resourceId: string; resource: PublicationApplicationResourceInput }
  | { op: 'remove-resource'; resourceId: string };
export interface PublicationConfigurationUpdate {
  expectedRevision: number;
  operations: PublicationConfigurationOperation[];
}
export interface PublicationProjectConfiguration {
  schemaVersion: 1;
  proposal: { id: string; token: string } | null;
  id: string | null;
  revision: number;
  apps: PublicationApp[];
  resources: PublicationApplicationResourceInput[];
  deployments: Array<{ appId: string | null; configured: boolean; publication: PublicationData }>;
}
export interface PublicationApplicationPlanInput { expectedRevision: number; appIds?: string[] }
export interface PublicationApplicationPlan {
  schemaVersion: 1;
  configurationId: string;
  configurationRevision: number;
  apps: Array<PublicationApp & {
    action: 'create' | 'update' | 'retry'; publicationId: string | null;
    routeAttachment: 'pending_after_deployment' | 'not_required';
    /** Digest fingerprints the reviewed workspace; revision is the last synced Git commit, before native commit-and-push preparation. */
    source: { type: 'workspace' | 'git'; repository: string | null; branch: string | null; revision: string | null; digest: string | null };
  }>;
  resources: PublicationApplicationResourceInput[];
  review: {
    id: string; ready: boolean; blockers: Array<{ code: string; message: string }>;
    destinations: Record<string, string | null>;
    productionVariables: string[]; configuration: PublicationConfigurationField[];
    source: { type: 'workspace' | 'git' | 'mixed'; repository: string | null; branch: string | null; revision: string | null; digest: string | null };
    digest: string; proposal: string;
  };
}
export interface PublicationApplicationPublishInput { reviewId: string; proposal: string; appIds?: string[] }
export interface PublicationApplicationConfirmationRequired {
  confirmationRequired: true;
  plan: PublicationApplicationPlan;
  changes: string[];
}
export type PublicationApplicationPublishResult = PublicationApplicationData | PublicationApplicationConfirmationRequired;
export interface PublicationApplicationAppData {
  appId: string;
  configurationRevision: number | null;
  publication: PublicationData;
  runtime: { status: 'healthy' | 'unknown' | 'stopped'; state: Record<string, unknown> };
  routing: {
    managedAddress: PublicationManagedAddress;
    status: 'connected' | 'pending' | 'failed';
    routes: Array<{ hostname: string; status: string; error: string | null }>;
    errors: Record<string, string>;
  };
}
export interface PublicationApplicationData {
  id: string;
  status: 'publishing' | 'healthy' | 'partial' | 'failed' | 'deleted';
  apps: PublicationApplicationAppData[];
  reviewId?: string;
  selectedAppIds?: string[];
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

export interface PublicationBuildData<TProvider extends PublicationProviderName = PublicationProviderName> {
  id: string;
  appId?: string | null;
  configurationRevision?: number | null;
  reviewId?: string | null;
  sourceRevision?: string | null;
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
  capabilities?: PublicationCapabilities;
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
  observation?: {
    status: 'present' | 'missing' | 'unreachable' | 'unauthorized' | 'unsupported';
    message: string;
    checkedAt: string;
  } | null;
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
