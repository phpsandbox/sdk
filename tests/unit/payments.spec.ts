import { ok } from 'node:assert/strict';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PHPSandbox } from '../../src/index.js';

afterEach(() => vi.unstubAllGlobals());

describe('managed payments', () => {
  it('addresses a sandbox without fetching or starting its runtime', async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json({ data: null }));
    vi.stubGlobal('fetch', fetch);
    const sdk = PHPSandbox.rest('hfp_example', 'https://api.example.test/v1');
    expect(await sdk.payments.forNotebook('sdk-only').get('test')).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0]?.[0].url).toContain('/platform/payments/sandboxes/sdk-only/test');
  });

  it('lists payment applications through the ownership-checked notebook endpoint', async () => {
    const data = {
      notebookId: 'sdk-only',
      applications: [
        {
          id: 'app-1',
          url: 'https://course.example.test',
          healthy: true,
          deployedAt: '2026-10-19T12:00:00.000Z',
          passwordProtected: false,
        },
      ],
    };
    const fetch = vi.fn(async (request: Request) => {
      expect(request.method).toBe('GET');
      expect(request.url).toBe('https://api.example.test/v1/notebook/sdk-only/payments/applications');
      expect(request.headers.get('authorization')).toBe('Bearer hfp_example');
      return Response.json({ data });
    });
    vi.stubGlobal('fetch', fetch);
    const sdk = PHPSandbox.rest('hfp_example', 'https://api.example.test/v1');

    await expect(sdk.payments.applications('sdk-only')).resolves.toEqual(data);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('rejects payment application metadata with missing protection state', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        Response.json({
          data: {
            notebookId: 'sdk-only',
            applications: [{ id: 'app-1', url: null, healthy: true, deployedAt: null }],
          },
        })
      )
    );
    const sdk = PHPSandbox.rest('hfp_example', 'https://api.example.test/v1');

    await expect(sdk.payments.applications('sdk-only')).rejects.toThrow();
  });

  it('validates payment access responses instead of granting malformed entitlements', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ data: { subscribed: true } })));
    const sdk = PHPSandbox.rest('hfp_example', 'https://api.example.test/v1');
    await expect(sdk.payments.access()).rejects.toThrow();
  });

  it('preserves the checkout identity and explicit mode across retries', async () => {
    const transaction = {
      subscriptionId: null,
      periodStart: null,
      periodEnd: null,
      id: 'purchase-1',
      bindingId: 'binding-1',
      priceId: 'price-1',
      orderId: 'course-1',
      amount: 4900,
      currency: 'eur',
      feeAmount: 0,
      refundedAmount: 0,
      revision: 0,
      status: 'pending',
      checkoutUrl: 'https://checkout.stripe.com/example',
      deliveredAt: null,
    };
    const fetch = vi.fn().mockImplementation(async (request: Request) => {
      expect(await request.json()).toEqual(input);
      return Response.json({ data: transaction });
    });
    vi.stubGlobal('fetch', fetch);
    const input = {
      requestId: '11111111-1111-4111-8111-111111111111',
      orderId: 'course-1',
      priceId: 'price-1',
      successPath: '/thanks',
      cancelPath: '/course',
    };
    const payments = PHPSandbox.rest('hfp_example', 'https://api.example.test/v1').payments.forNotebook('sandbox-1');
    await expect(payments.checkout(input, 'test')).resolves.toEqual(transaction);
    await expect(payments.checkout(input, 'test')).resolves.toEqual(transaction);
    expect(fetch).toHaveBeenCalledTimes(2);
    const request = fetch.mock.calls[1]?.[0];
    ok(request instanceof Request);
    expect(request.url).toContain('/sandbox-1/test/checkouts');
  });
});

describe('recurring payments', () => {
  const subscription = {
    id: 'sub-1',
    bindingId: 'binding-1',
    priceId: 'price-1',
    orderId: 'order-1',
    status: 'active',
    billingInterval: 'month',
    paidThrough: '2027-01-01T00:00:00.000Z',
    cancelAtPeriodEnd: false,
    checkoutUrl: null,
    revision: 1,
  };

  it('routes recurring operations with explicit mode and application scoping', async () => {
    const requests: Request[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (request: Request) => {
        requests.push(request);
        return Response.json({ data: subscription });
      })
    );
    const payments = PHPSandbox.rest('hfp_example', 'https://api.example.test/v1').payments.forNotebook('sandbox-1');
    const input = { requestId: 'request-1', orderId: 'order-1', priceId: 'price-1', successPath: '/account', cancelPath: '/' };
    await payments.subscribe(input, 'live');
    await payments.subscription('sub-1', 'live');
    await payments.cancelSubscription('sub-1', 'live');
    expect(requests.map((request) => [request.method, new URL(request.url).pathname])).toEqual([
      ['POST', '/v1/platform/payments/sandboxes/sandbox-1/live/subscriptions'],
      ['GET', '/v1/platform/payments/sandboxes/sandbox-1/live/subscriptions/sub-1'],
      ['POST', '/v1/platform/payments/sandboxes/sandbox-1/live/subscriptions/sub-1/cancel'],
    ]);
    expect(await requests[0]?.json()).toEqual(input);
    expect(await requests[2]?.json()).toEqual({});
  });

  it('supports server-only runtime checkout and billing portal without fetching notebook metadata', async () => {
    const requests: Request[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (request: Request) => {
        requests.push(request);
        if (request.url.endsWith('/portal')) {
          return Response.json({ data: { url: 'https://billing.stripe.com/example' } });
        }
        return Response.json({ data: subscription });
      })
    );
    const runtime = PHPSandbox.rest('hpay_example', 'https://api.example.test/v1').payments.runtime;
    await runtime.subscribe({
      requestId: 'request-1',
      orderId: 'order-1',
      priceId: 'price-1',
      successPath: '/account',
      cancelPath: '/',
    });
    await runtime.subscriptionPortal('sub-1', { returnPath: '/account' });
    expect(requests.map((request) => new URL(request.url).pathname)).toEqual([
      '/v1/platform/payments/runtime/subscriptions',
      '/v1/platform/payments/runtime/subscriptions/sub-1/portal',
    ]);
    expect(await requests[1]?.json()).toEqual({ returnPath: '/account' });
  });

  it('rejects malformed subscription periods at the response boundary', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ data: { ...subscription, billingInterval: 'week' } })));
    const runtime = PHPSandbox.rest('hpay_example', 'https://api.example.test/v1').payments.runtime;
    await expect(runtime.subscription('sub-1')).rejects.toThrow();
  });
});
