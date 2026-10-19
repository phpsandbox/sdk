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

  it('validates payment access responses instead of granting malformed entitlements', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ data: { subscribed: true } })));
    const sdk = PHPSandbox.rest('hfp_example', 'https://api.example.test/v1');
    await expect(sdk.payments.access()).rejects.toThrow();
  });

  it('preserves the checkout identity and explicit mode across retries', async () => {
    const transaction = {
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
