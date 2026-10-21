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
      expect(await request.json()).toEqual({ externalId: 'app-user-1', email: 'alex@example.test' });
      return Response.json({ data: customer });
    });
    vi.stubGlobal('fetch', fetch);
    const client = PHPSandbox.rest('hcust_example', 'https://api.example.test/v1');

    await expect(client.customers.runtime.identify({ externalId: 'app-user-1', email: 'alex@example.test' })).resolves.toEqual(
      customer
    );
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
