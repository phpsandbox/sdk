import { PHPSandbox, RemoteError } from '@phpsandbox/sdk';
import { describe, expect, test } from 'vitest';
import { readResourceReaperEnvironment } from '../support/environment.js';
import {
  isExpiredResourceLease,
  PublicationResourceLeaseRegistry,
  type StoredPublicationResourceLease,
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

async function reapPublicationResources(
  client: PHPSandbox,
  registry: PublicationResourceLeaseRegistry,
  stored: StoredPublicationResourceLease,
): Promise<void> {
  const { lease } = stored;
  console.log(`Reaping ${lease.provider} resources for workflow ${lease.runId}.${lease.runAttempt}.`);

  const notebook = await operation('read abandoned publication sandbox', () => client.notebook.get(lease.notebookId));
  const publication = await operation('read abandoned publication', () => notebook.publication());
  if (publication !== null) {
    if (publication.data.provider.name !== lease.provider) {
      throw new Error(
        `Refusing to delete publication ${publication.data.id}: expected provider ${lease.provider}, `
        + `received ${publication.data.provider.name}.`,
      );
    }
    await operation(`destroy abandoned ${lease.provider} publication`, () => publication.destroy(), 300_000);
  }

  if (lease.provider === 'ssh-server' && lease.server !== undefined) {
    const serverId = lease.server.id ?? await findServerIdByExactName(client, lease.server.name);
    if (serverId !== undefined) {
      await ignoreMissing(() => operation('delete abandoned Rook server registration', () => (
        client.servers.get(serverId).then((server) => server.delete())
      )));
    }
  }

  await ignoreMissing(() => operation('delete abandoned publication sandbox', () => (
    notebook.destroy()
  )));
  await operation('release reaped resource lease', () => registry.delete(stored));
}

async function findServerIdByExactName(client: PHPSandbox, name: string): Promise<string | undefined> {
  let page = 1;
  let lastPage = 1;
  do {
    const response = await client.servers.list({ page });
    const matching = response.data.find((server) => server.name === name);
    if (matching !== undefined) {
      return matching.id;
    }

    lastPage = paginationLastPage(response.meta);
    page += 1;
  } while (page <= lastPage);

  return undefined;
}

function paginationLastPage(meta: Record<string, unknown> | undefined): number {
  const lastPage = meta?.last_page;
  return typeof lastPage === 'number' && Number.isInteger(lastPage) && lastPage > 0 ? lastPage : 1;
}

async function ignoreMissing(callback: () => Promise<void>): Promise<void> {
  try {
    await callback();
  } catch (error) {
    if (!(RemoteError.is(error) && error.status === 404)) {
      throw error;
    }
  }
}
