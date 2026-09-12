import { PHPSandbox } from '@phpsandbox/sdk';
import { describe, expect, test } from 'vitest';
import { readResourceReaperEnvironment } from '../support/environment.js';
import {
  isExpiredResourceLease,
  PublicationResourceLeaseRegistry,
  reapPublicationResources,
} from '../support/resource-leases.js';
import { operation } from '../support/resources.js';

const reaperTimeoutMs = 15 * 60 * 1_000;

describe('stale production smoke resource reaper', () => {
  test('removes only expired resources owned by the selected provider', async () => {
    const environment = readResourceReaperEnvironment();
    const client = PHPSandbox.rest(environment.token, environment.apiUrl);
    const registry = new PublicationResourceLeaseRegistry(environment.github, environment.resourceRegistry);
    const leases = await operation(
      `list ${environment.provider} resource leases`,
      () => registry.list(environment.provider),
    );
    const expired = leases.filter((stored) => isExpiredResourceLease(stored.lease, environment.maxAgeHours));
    const active = leases.length - expired.length;
    console.log(`Found ${expired.length} expired and ${active} active ${environment.provider} resource lease(s).`);

    const failures: Error[] = [];
    for (const stored of expired) {
      try {
        await reapPublicationResources(client, registry, stored);
      } catch (error) {
        failures.push(error instanceof Error ? error : new Error(String(error)));
      }
    }

    expect(failures, failures.map((failure) => failure.message).join('\n')).toHaveLength(0);
  }, reaperTimeoutMs);
});
