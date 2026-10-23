import { afterEach, describe, expect, it, vi } from 'vitest';
import { PHPSandbox } from '../../src/index.js';

afterEach(() => vi.unstubAllGlobals());

const customer = {
  id: 'customer-1',
  externalId: 'app-user-1',
  email: 'alex@example.test',
  name: 'Alex',
  source: null,
  marketingSubscribed: false,
  suppressionReason: null,
  activatedAt: null,
  createdAt: '2026-10-20T12:00:00Z',
};

describe('Customers', () => {
  it('identifies an app customer with the runtime credential and preserves input', async () => {
    const fetch = vi.fn(async (request: Request) => {
      expect(request.url).toBe('https://api.example.test/v1/platform/customers/runtime/identify');
      expect(request.method).toBe('POST');
      expect(request.headers.get('authorization')).toBe('Bearer hcust_example');
      expect(await request.json()).toEqual({ externalId: 'app-user-1', email: 'alex@example.test', billingStatus: 'free' });
      return Response.json({ data: customer });
    });
    vi.stubGlobal('fetch', fetch);
    const client = PHPSandbox.rest('hcust_example', 'https://api.example.test/v1');

    await expect(
      client.customers.runtime.identify({ externalId: 'app-user-1', email: 'alex@example.test', billingStatus: 'free' })
    ).resolves.toEqual(customer);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('lists an SDK-only notebook without opening realtime transport', async () => {
    const result = { space: null, customers: [], journeys: [], messages: [], total: 0 };
    const fetch = vi.fn(async (request: Request) => {
      expect(request.url).toBe('https://api.example.test/v1/platform/customers/sandboxes/sdk-only/test?search=Alex&page=2');
      return Response.json({ data: result });
    });
    vi.stubGlobal('fetch', fetch);
    const client = PHPSandbox.rest('hfp_example', 'https://api.example.test/v1');

    await expect(client.customers.forNotebook('sdk-only').list('test', { search: 'Alex', page: 2 })).resolves.toEqual(result);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('rejects incomplete runtime responses', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ data: { id: 'customer-1' } }))
    );
    const client = PHPSandbox.rest('hcust_example', 'https://api.example.test/v1');

    await expect(client.customers.runtime.get('customer-1')).rejects.toThrow();
  });

  it('records activity using the supplied stable event identity', async () => {
    const fetch = vi.fn(async (request: Request) => {
      expect(request.url).toBe('https://api.example.test/v1/platform/customers/runtime/customer-1/events');
      expect(await request.json()).toEqual({ eventId: 'booking-1', name: 'booking.created' });
      return Response.json({ data: { id: 'event-1', name: 'booking.created' } });
    });
    vi.stubGlobal('fetch', fetch);
    const client = PHPSandbox.rest('hcust_example', 'https://api.example.test/v1');

    await expect(
      client.customers.runtime.event('customer-1', { eventId: 'booking-1', name: 'booking.created' })
    ).resolves.toEqual({ id: 'event-1', name: 'booking.created' });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

describe('Application customer synchronization', () => {
  const token = `happ_${'a'.repeat(64)}`;
  const environment = { PHPSANDBOX_APP_TEST_TOKEN: token, PHPSANDBOX_APP_API_URL: 'https://api.example.test/v1' };
  const organization = {
    id: 'org-1',
    externalId: 'app-org/1',
    name: 'Example',
    ownerCustomerId: 'customer-1',
    firstPaidAt: null,
    activatedAt: null,
  };

  it('preserves historical metadata and a separate legacy policy through the supported app client', async () => {
    const input = {
      externalId: 'app-user-1',
      email: 'alex@example.test',
      historical: true,
      joinedAt: '2020-01-01T00:00:00Z',
      legacyPolicy: 'existing-accounts-v1',
    };
    const fetch = vi.fn(async (request: Request) => {
      expect(request.headers.get('authorization')).toBe(`Bearer ${token}`);
      expect(request.url).toBe('https://api.example.test/v1/platform/customers/runtime/identify');
      expect(await request.json()).toEqual(input);
      return Response.json({ data: { ...customer, communicationBasis: 'legacy_account', legacyPolicy: 'existing-accounts-v1' } });
    });
    vi.stubGlobal('fetch', fetch);
    const app = PHPSandbox.app({ mode: 'test', env: environment });

    const result = await app.customers.identify(input);

    expect(result.communicationBasis).toBe('legacy_account');
    expect(result.marketingSubscribed).toBe(false);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('sends organization membership as an authoritative snapshot', async () => {
    const input = {
      externalId: 'app-org/1',
      name: 'Example',
      ownerExternalId: 'app-user-1',
      members: [{ externalId: 'app-user-2', role: 'member' }],
    };
    const fetch = vi.fn(async (request: Request) => {
      expect(request.method).toBe('PUT');
      expect(request.url).toBe('https://api.example.test/v1/platform/customers/runtime/organizations');
      expect(request.headers.get('authorization')).toBe(`Bearer ${token}`);
      expect(await request.json()).toEqual(input);
      return Response.json({ data: organization });
    });
    vi.stubGlobal('fetch', fetch);
    const app = PHPSandbox.app({ mode: 'test', env: environment });

    await expect(app.customers.organization(input)).resolves.toEqual(organization);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('reports confirmed payments with encoded organization identity and original payment facts', async () => {
    const input = {
      paymentId: 'invoice-1',
      amountMinor: 2000,
      currency: 'usd',
      paidAt: '2026-10-23T12:00:00Z',
      historical: false,
    };
    const fetch = vi.fn(async (request: Request) => {
      expect(request.method).toBe('POST');
      expect(request.url).toBe('https://api.example.test/v1/platform/customers/runtime/organizations/app-org%2F1/payments');
      expect(await request.json()).toEqual(input);
      return Response.json({ data: organization });
    });
    vi.stubGlobal('fetch', fetch);
    const app = PHPSandbox.app({ mode: 'test', env: environment });

    await expect(app.customers.confirmPayment('app-org/1', input)).resolves.toEqual(organization);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
