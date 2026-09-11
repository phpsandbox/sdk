export const capabilityIds = [
  'sdk.contracts',
  'client.core-http',
  'client.runtime-selection',
  'notebook.lifecycle',
  'notebook.fork',
  'runtime.initialization',
  'runtime.events',
  'runtime.lifecycle',
  'runtime.metrics',
  'filesystem.basic',
  'filesystem.management',
  'filesystem.search',
  'filesystem.streaming',
  'filesystem.watch',
  'shell.exec',
  'shell.streaming',
  'terminal',
  'terminal.attach',
  'php.version',
  'config.read',
  'config.write',
  'ports.read',
  'telemetry.streaming',
  'logs.streaming',
  'services.read',
  'services.manage',
  'composer.read',
  'composer.mutate',
  'git.read',
  'git.mutate',
  'repl',
  'lsp',
  'secrets',
  'composer.credentials',
  'preview',
  'mail.read',
  'mail.manage',
  'feedback',
  'publication.read',
  'publication.manage',
  'server.read',
  'server.manage',
  'beacon',
] as const;

export type CapabilityId = (typeof capabilityIds)[number];
export type CapabilityTier = 'unit' | 'pr' | 'nightly' | 'external';
export type CapabilityTransport = 'core' | 'http' | 'realtime';

interface CapabilityBase {
  readonly area: string;
  readonly transports: readonly CapabilityTransport[];
}

interface CoveredCapability extends CapabilityBase {
  readonly status: 'covered';
  readonly tier: Exclude<CapabilityTier, 'external'>;
  readonly specs: readonly [string, ...string[]];
}

interface KnownBrokenCapability extends CapabilityBase {
  readonly status: 'known-broken';
  readonly tier: 'nightly';
  readonly specs: readonly [string, ...string[]];
  readonly reason: string;
}

interface ExternalCapability extends CapabilityBase {
  readonly status: 'external';
  readonly tier: 'external';
  readonly specs: readonly [];
  readonly reason: string;
}

export type Capability = CoveredCapability | KnownBrokenCapability | ExternalCapability;

const prCanary = 'tests/smoke/pr/canary.smoke.ts';
const filesystemNightly = 'tests/smoke/nightly/filesystem.smoke.ts';
const runtimeNightly = 'tests/smoke/nightly/runtime.smoke.ts';
const platformNightly = 'tests/smoke/nightly/platform.smoke.ts';
const realtimeNightly = 'tests/smoke/nightly/realtime.smoke.ts';
const githubNightly = 'tests/smoke/nightly/github.smoke.ts';
const publicationNightly = 'tests/smoke/nightly/publication.smoke.ts';
const composerCredentialIntegration = 'tests/smoke/integrations/composer-credentials.smoke.ts';
const beaconIntegration = 'tests/smoke/integrations/beacon.smoke.ts';
const feedbackWidgetIntegration = 'tests/smoke/integrations/feedback-widget.smoke.ts';

export const capabilities: Record<CapabilityId, Capability> = {
  'sdk.contracts': covered('SDK runtime exports, errors, schemas, and value objects', ['core'], 'unit', 'tests/smoke/meta/capabilities.spec.ts'),
  'client.core-http': covered('Authenticated Core API requests', ['core'], 'nightly', platformNightly),
  'client.runtime-selection': covered('Explicit HTTP and realtime runtime selection', ['http', 'realtime'], 'pr', prCanary),
  'notebook.lifecycle': covered('Create, get, initialize, and destroy sandboxes', ['core', 'http', 'realtime'], 'pr', prCanary, platformNightly),
  'notebook.fork': covered(
    'Fork and initialize sandboxes',
    ['core', 'http', 'realtime'],
    'nightly',
    platformNightly,
  ),
  'runtime.initialization': covered('Runtime initialization result and preview URL', ['http', 'realtime'], 'pr', prCanary),
  'runtime.events': covered('Runtime lifecycle events and reconnect behavior', ['realtime'], 'nightly', realtimeNightly),
  'runtime.lifecycle': covered('Runtime stop, restart, and recovery', ['http', 'realtime'], 'nightly', runtimeNightly),
  'runtime.metrics': covered('Current runtime resource metrics', ['http', 'realtime'], 'nightly', runtimeNightly),
  'filesystem.basic': covered('Exact file write and read', ['http', 'realtime'], 'pr', prCanary),
  'filesystem.management': covered('Directory, stat, list, copy, move, remove, tree, and tail operations', ['http', 'realtime'], 'nightly', filesystemNightly),
  'filesystem.search': covered('Filename and text search', ['http', 'realtime'], 'nightly', filesystemNightly),
  'filesystem.streaming': covered('Streamed file reads', ['http', 'realtime'], 'nightly', filesystemNightly),
  'filesystem.watch': covered('Realtime filesystem change subscriptions', ['realtime'], 'nightly', realtimeNightly),
  'shell.exec': covered('Command execution, arguments, output streams, and exit codes', ['http', 'realtime'], 'pr', prCanary, runtimeNightly),
  'shell.streaming': covered('Interactive native shell streams, stdin, completion, and cancellation', ['realtime'], 'nightly', realtimeNightly),
  'terminal': covered('TTY process creation, listing, output, and completion', ['realtime'], 'nightly', realtimeNightly),
  'terminal.attach': covered('Attachment to an existing TTY process with history replay', ['realtime'], 'nightly', realtimeNightly),
  'php.version': covered('PHP 8.2, 8.3, and 8.4 switching with restoration', ['http', 'realtime'], 'nightly', runtimeNightly),
  'config.read': covered('Project configuration reads', ['http', 'realtime'], 'nightly', runtimeNightly),
  'config.write': covered('Project configuration and port mapping mutations with restoration', ['http', 'realtime'], 'nightly', runtimeNightly),
  'ports.read': covered('Opened port inspection', ['http', 'realtime'], 'nightly', runtimeNightly),
  'telemetry.streaming': covered('Metrics and port telemetry subscriptions', ['realtime'], 'nightly', realtimeNightly),
  'logs.streaming': covered('Runtime log subscriptions', ['realtime'], 'nightly', realtimeNightly),
  'services.read': covered('Service discovery', ['http', 'realtime'], 'nightly', runtimeNightly),
  'services.manage': covered('Service start, stop, and log streaming', ['http', 'realtime'], 'nightly', runtimeNightly),
  'composer.read': covered('Installed Composer package inspection', ['http', 'realtime'], 'nightly', runtimeNightly),
  'composer.mutate': covered('Composer install, update, require, remove, and autoload over HTTP/realtime; cancellation over realtime', ['http', 'realtime'], 'nightly', runtimeNightly),
  'git.read': covered('Git repository status, history, review, conflicts, and sync-target inspection', ['http', 'realtime'], 'nightly', runtimeNightly, githubNightly),
  'git.mutate': covered('Checkpoint, checkout, index, diff, merge, restore, and GitHub provider synchronization', ['http', 'realtime'], 'nightly', runtimeNightly, platformNightly, githubNightly),
  'repl': covered('PHP REPL evaluation', ['realtime'], 'nightly', realtimeNightly),
  'lsp': covered('Intelephense initialization, PHP document symbols, shutdown, and lifecycle events', ['realtime'], 'nightly', realtimeNightly),
  'secrets': covered('Notebook secret create, list, redaction, and delete', ['core'], 'nightly', platformNightly),
  'composer.credentials': covered(
    'Private package authentication, credential redaction, removal, and revoked access',
    ['core', 'http'],
    'nightly',
    composerCredentialIntegration,
  ),
  'preview': covered(
    'Preview protection lifecycle',
    ['core'],
    'nightly',
    platformNightly,
  ),
  'mail.read': covered('Captured-mail service state', ['core'], 'nightly', platformNightly),
  'mail.manage': covered('Captured-mail enablement, SMTP delivery, retrieval, deletion, and disablement', ['core'], 'nightly', platformNightly),
  'feedback': covered(
    'Notebook feedback API and authenticated preview widget lifecycle',
    ['core'],
    'nightly',
    platformNightly,
    feedbackWidgetIntegration,
  ),
  'publication.read': covered('Current publication state', ['core'], 'nightly', platformNightly),
  'publication.manage': covered('Cloudflare Containers, SSH server, and Laravel Cloud publication lifecycles, protection, events, logs, and teardown', ['core'], 'nightly', publicationNightly),
  'server.read': covered('Account server listing', ['core'], 'nightly', platformNightly),
  'server.manage': covered('Rook server registration, connection, publication use, agent purge, and deletion', ['core'], 'nightly', publicationNightly),
  'beacon': covered(
    'Browser Beacon connection, navigation, inspection, events, execution, fetch, screenshot, and disposal',
    ['realtime'],
    'nightly',
    beaconIntegration,
  ),
};

function covered(
  area: string,
  transports: readonly CapabilityTransport[],
  tier: CoveredCapability['tier'],
  ...specs: readonly [string, ...string[]]
): CoveredCapability {
  return { area, specs, status: 'covered', tier, transports };
}

function knownBroken(
  area: string,
  transports: readonly CapabilityTransport[],
  reason: string,
  ...specs: readonly [string, ...string[]]
): KnownBrokenCapability {
  return { area, reason, specs, status: 'known-broken', tier: 'nightly', transports };
}

function external(area: string, transports: readonly CapabilityTransport[], reason: string): ExternalCapability {
  return { area, reason, specs: [], status: 'external', tier: 'external', transports };
}
