const DEFAULT_API_URL = 'https://api.phpsandbox.io/v1';

export type SmokeTransport = 'http' | 'realtime';

export interface SmokeEnvironment {
  readonly apiUrl: string;
  readonly runId: string;
  readonly token: string;
  readonly transport: SmokeTransport;
  readonly workflowAttempt: string;
  readonly workflowRunId: string;
}

export interface GitHubSmokeEnvironment {
  readonly owner: string;
  readonly token: string;
}

export interface ComposerCredentialSmokeEnvironment {
  readonly github: GitHubSmokeEnvironment;
  readonly repository: string;
}

export interface FeedbackReviewerSmokeEnvironment {
  readonly password: string;
  readonly username: string;
}

export type PublicationSmokeProvider = 'cloudflare-containers' | 'laravel-cloud' | 'ssh-server';

export interface PublicationSmokeEnvironment {
  readonly cloudflareAccountId?: string;
  readonly cloudflareApiToken?: string;
  readonly github: GitHubSmokeEnvironment;
  readonly laravelCloudApiKey?: string;
  readonly provider: PublicationSmokeProvider;
  readonly resourceRegistry: SmokeResourceRegistryEnvironment;
  readonly repository: string;
}

export interface SmokeResourceRegistryEnvironment {
  readonly branch: string;
  readonly repository: string;
}

export interface ResourceReaperEnvironment extends SmokeEnvironment {
  readonly github: GitHubSmokeEnvironment;
  readonly maxAgeHours: number;
  readonly provider: PublicationSmokeProvider;
  readonly resourceRegistry: SmokeResourceRegistryEnvironment;
}

export function hasGitHubSmokeEnvironment(): boolean {
  const owner = optionalEnvironmentValue('PHPSANDBOX_SMOKE_GITHUB_OWNER');
  const token = optionalEnvironmentValue('PHPSANDBOX_SMOKE_GITHUB_TOKEN');

  if ((owner === undefined) !== (token === undefined)) {
    throw new Error(
      'PHPSANDBOX_SMOKE_GITHUB_OWNER and PHPSANDBOX_SMOKE_GITHUB_TOKEN must be configured together.',
    );
  }

  return owner !== undefined && token !== undefined;
}

export function readGitHubSmokeEnvironment(): GitHubSmokeEnvironment {
  const owner = optionalEnvironmentValue('PHPSANDBOX_SMOKE_GITHUB_OWNER');
  const token = optionalEnvironmentValue('PHPSANDBOX_SMOKE_GITHUB_TOKEN');

  if (owner === undefined || token === undefined) {
    throw new Error('Missing GitHub provider smoke environment.');
  }

  return { owner, token };
}

export function readComposerCredentialSmokeEnvironment(): ComposerCredentialSmokeEnvironment {
  const repository = optionalEnvironmentValue('PHPSANDBOX_SMOKE_COMPOSER_REPOSITORY');
  if (repository === undefined || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) {
    throw new TypeError('PHPSANDBOX_SMOKE_COMPOSER_REPOSITORY must be an owner/name repository.');
  }

  return {
    github: readGitHubSmokeEnvironment(),
    repository,
  };
}

export function readFeedbackReviewerSmokeEnvironment(): FeedbackReviewerSmokeEnvironment {
  const username = optionalEnvironmentValue('PHPSANDBOX_SMOKE_REVIEWER_USERNAME');
  const password = optionalEnvironmentValue('PHPSANDBOX_SMOKE_REVIEWER_PASSWORD');

  if (username === undefined || password === undefined) {
    throw new Error('Missing feedback reviewer smoke credentials.');
  }

  return { password, username };
}

export function readPublicationSmokeEnvironment(): PublicationSmokeEnvironment {
  const provider = optionalEnvironmentValue('PHPSANDBOX_SMOKE_PUBLICATION_PROVIDER');
  if (provider !== 'cloudflare-containers' && provider !== 'laravel-cloud' && provider !== 'ssh-server') {
    throw new TypeError(
      'PHPSANDBOX_SMOKE_PUBLICATION_PROVIDER must be "cloudflare-containers", "laravel-cloud", or "ssh-server".',
    );
  }

  const repository = optionalEnvironmentValue('PHPSANDBOX_SMOKE_PUBLICATION_REPOSITORY');
  if (repository === undefined || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) {
    throw new TypeError('PHPSANDBOX_SMOKE_PUBLICATION_REPOSITORY must be an owner/name repository.');
  }

  const laravelCloudApiKey = optionalEnvironmentValue('PHPSANDBOX_SMOKE_LARAVEL_CLOUD_API_KEY');
  if (provider === 'laravel-cloud' && laravelCloudApiKey === undefined) {
    throw new Error('Missing PHPSANDBOX_SMOKE_LARAVEL_CLOUD_API_KEY.');
  }

  const cloudflareAccountId = optionalEnvironmentValue('PHPSANDBOX_SMOKE_CLOUDFLARE_ACCOUNT_ID');
  const cloudflareApiToken = optionalEnvironmentValue('PHPSANDBOX_SMOKE_CLOUDFLARE_API_TOKEN');
  if (provider === 'cloudflare-containers' && (cloudflareAccountId === undefined || cloudflareApiToken === undefined)) {
    throw new Error('Missing PHPSANDBOX_SMOKE_CLOUDFLARE_ACCOUNT_ID or PHPSANDBOX_SMOKE_CLOUDFLARE_API_TOKEN.');
  }

  return {
    ...(cloudflareAccountId === undefined ? {} : { cloudflareAccountId }),
    ...(cloudflareApiToken === undefined ? {} : { cloudflareApiToken }),
    github: readGitHubSmokeEnvironment(),
    ...(laravelCloudApiKey === undefined ? {} : { laravelCloudApiKey }),
    provider,
    resourceRegistry: readSmokeResourceRegistryEnvironment(),
    repository,
  };
}

export function readResourceReaperEnvironment(): ResourceReaperEnvironment {
  const provider = readPublicationProvider('PHPSANDBOX_SMOKE_REAPER_PROVIDER');
  const maxAge = optionalEnvironmentValue('PHPSANDBOX_SMOKE_RESOURCE_MAX_AGE_HOURS') ?? '6';
  const maxAgeHours = Number(maxAge);
  if (!Number.isFinite(maxAgeHours) || maxAgeHours <= 0) {
    throw new TypeError('PHPSANDBOX_SMOKE_RESOURCE_MAX_AGE_HOURS must be a positive number.');
  }

  return {
    ...readSmokeEnvironment(),
    github: readGitHubSmokeEnvironment(),
    maxAgeHours,
    provider,
    resourceRegistry: readSmokeResourceRegistryEnvironment(),
  };
}

function readSmokeResourceRegistryEnvironment(): SmokeResourceRegistryEnvironment {
  const repository = optionalEnvironmentValue('PHPSANDBOX_SMOKE_RESOURCE_REGISTRY');
  if (repository === undefined || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) {
    throw new TypeError('PHPSANDBOX_SMOKE_RESOURCE_REGISTRY must be an owner/name repository.');
  }

  const branch = optionalEnvironmentValue('PHPSANDBOX_SMOKE_RESOURCE_REGISTRY_BRANCH');
  if (branch === undefined || !/^[A-Za-z0-9._/-]+$/.test(branch)) {
    throw new TypeError('PHPSANDBOX_SMOKE_RESOURCE_REGISTRY_BRANCH must be a branch name.');
  }

  return { branch, repository };
}

function readPublicationProvider(name: string): PublicationSmokeProvider {
  const provider = optionalEnvironmentValue(name);
  if (provider !== 'cloudflare-containers' && provider !== 'laravel-cloud' && provider !== 'ssh-server') {
    throw new TypeError(`${name} must be "cloudflare-containers", "laravel-cloud", or "ssh-server".`);
  }

  return provider;
}

function optionalEnvironmentValue(name: string): string | undefined {
  const value = process.env[name]?.trim();

  return value === '' ? undefined : value;
}

export function readSmokeEnvironment(): SmokeEnvironment {
  const transport = process.env.PHPSANDBOX_SMOKE_TRANSPORT;
  if (transport !== 'http' && transport !== 'realtime') {
    throw new TypeError('PHPSANDBOX_SMOKE_TRANSPORT must be either "http" or "realtime".');
  }

  const token = process.env.PHPSANDBOX_SMOKE_TOKEN;
  if (token === undefined || token.trim() === '') {
    throw new Error('Missing PHPSANDBOX_SMOKE_TOKEN.');
  }

  const apiUrl = process.env.PHPSANDBOX_API_URL ?? DEFAULT_API_URL;
  try {
    new URL(apiUrl);
  } catch {
    throw new TypeError('PHPSANDBOX_API_URL must be a valid URL.');
  }

  const workflowRunId = process.env.GITHUB_RUN_ID ?? 'local';
  const workflowAttempt = process.env.GITHUB_RUN_ATTEMPT ?? '1';

  return {
    apiUrl,
    runId: `${workflowRunId}.${workflowAttempt}`,
    token,
    transport,
    workflowAttempt,
    workflowRunId,
  };
}
