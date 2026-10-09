export type LaravelCloudRegion =
  | 'us-east-2'
  | 'us-east-1'
  | 'ca-central-1'
  | 'eu-central-1'
  | 'eu-west-1'
  | 'eu-west-2'
  | 'me-central-1'
  | 'ap-southeast-1'
  | 'ap-southeast-2'
  | 'ap-northeast-1';

export interface LaravelCloudResourceInput {
  mode: 'none' | 'reuse' | 'create';
  id?: string;
  type?: string;
  version?: string;
  size?: string;
  config?: Record<string, string | number | boolean | null>;
}

export interface LaravelCloudSetupInput {
  repositoryAccessConfirmed?: boolean;
  database?: LaravelCloudResourceInput;
  cache?: LaravelCloudResourceInput;
  storage?: LaravelCloudResourceInput;
  worker?: boolean;
  scheduler?: boolean;
  workerPlacement?: 'app' | 'separate';
  workerSize?: string;
  buildCommand?: string;
  deployCommand?: string;
}

export interface LaravelCloudCatalogResource {
  id: string;
  name: string;
  region: string | null;
  type: string | null;
  status: string | null;
  clusterId?: string;
  bucketId?: string;
  keyName?: string;
}

export interface LaravelCloudConfigField {
  name: string;
  type: string;
  required: boolean;
  nullable?: boolean;
  description?: string;
  min?: number;
  max?: number;
  enum?: Array<string | number>;
  example?: string | number;
}

export interface LaravelCloudDatabaseType {
  type: string;
  label: string;
  versions: string[];
  regions: string[];
  config_schema: LaravelCloudConfigField[];
}

export interface LaravelCloudCatalog {
  regions: Array<{ region: string; label: string; flag?: string }>;
  databaseTypes: LaravelCloudDatabaseType[];
  cacheTypes: Array<{
    type: string;
    label: string;
    regions: string[];
    sizes: Array<
      string | { value?: string; name?: string; size?: string; label?: string; supports_hibernation?: boolean }
    >;
  }>;
  databases: LaravelCloudCatalogResource[];
  caches: LaravelCloudCatalogResource[];
  storage: LaravelCloudCatalogResource[];
  pricingUrl: string;
}

export interface LaravelCloudSetupState {
  applicationId?: string;
  environmentId?: string;
  applicationManaged?: boolean;
  environmentManaged?: boolean;
  databaseId?: string;
  databaseIdManaged?: boolean;
  cacheId?: string;
  cacheIdManaged?: boolean;
  storageId?: string;
  storageIdManaged?: boolean;
  workerId?: string;
  backgroundInstanceId?: string;
  backgroundProcessId?: string;
  configuredAt?: string;
  retainedResources?: Array<{ kind: string; id: string; providerId: string; name: string | null }>;
  pendingCreation?: { resource: string; name: string | null; startedAt: string };
}

export interface LaravelCloudProviderData {
  setup?: LaravelCloudSetupInput;
  region?: LaravelCloudRegion;
  repository?: string;
  branch?: string;
  expectedCommitSha?: string | null;
  sourceControlProviderType?: 'github' | 'gitlab' | 'bitbucket';
}

export interface LaravelCloudProviderInput {
  setup?: LaravelCloudSetupInput;
  region: LaravelCloudRegion;
}

/** Keep retained resources when publishing again after removing the Cloud application. */
export function laravelCloudSetupForRepublish(
  setup: LaravelCloudSetupInput = {},
  state: LaravelCloudSetupState | null = null
): LaravelCloudSetupInput {
  const next: LaravelCloudSetupInput = { ...setup };
  const ids = { database: state?.databaseId, cache: state?.cacheId, storage: state?.storageId };
  for (const kind of ['database', 'cache', 'storage'] as const) {
    const id = ids[kind];
    if (setup[kind]?.mode === 'create' && id) {
      next[kind] = { mode: 'reuse', id };
    }
  }
  return next;
}
