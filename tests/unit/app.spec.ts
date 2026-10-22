import { afterEach, expect, it, vi } from 'vitest';
import { createHmac } from 'node:crypto';
import { PHPSandbox } from '../../src/index.js';

const token = `happ_${'a'.repeat(64)}`;
const otherToken = `happ_${'b'.repeat(64)}`;
const base = { PHPSANDBOX_APP_API_URL: 'https://api.example.test/v1', PHPSANDBOX_APP_TEST_TOKEN: token };
afterEach(() => vi.unstubAllGlobals());

it('uses one environment credential for Customers and Payments without exposing management APIs', async () => {
  const calls: Request[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (request: Request) => {
      calls.push(request);
      if (request.url.endsWith('/payments/runtime/prices')) {
        return Response.json({ data: [] });
      }
      if (request.url.endsWith('/customers/runtime/identify')) {
        return Response.json({
          data: {
            id: 'one',
            externalId: 'account-one',
            email: 'alex@example.test',
            name: null,
            source: null,
            marketingSubscribed: false,
            suppressionReason: null,
            activatedAt: null,
            createdAt: null,
          },
        });
      }
      throw new Error(`Unexpected request: ${request.url}`);
    })
  );
  const platform = PHPSandbox.app({ env: base });

  await platform.customers.identify({ externalId: 'account-one', email: 'alex@example.test' });
  await platform.payments.prices();

  expect(calls).toHaveLength(2);
  expect(calls.map((request) => request.headers.get('authorization'))).toEqual([`Bearer ${token}`, `Bearer ${token}`]);
  expect(platform.mode).toBe('test');
  expect(platform).not.toHaveProperty('notebook');
  expect(platform).not.toHaveProperty('servers');
});

it('selects production explicitly and never falls back to a development credential', () => {
  expect(() => PHPSandbox.app({ env: { ...base, NODE_ENV: 'production' } })).toThrow('production');
  const platform = PHPSandbox.app({ env: { ...base, NODE_ENV: 'production', PHPSANDBOX_APP_LIVE_TOKEN: otherToken } });
  expect(platform.mode).toBe('live');
  expect(PHPSandbox.app({ mode: 'test', env: { ...base, NODE_ENV: 'production' } }).mode).toBe('test');
});

it('verifies a payment callback using the same app credential', async () => {
  const platform = PHPSandbox.app({ env: base });
  const timestamp = Math.floor(Date.now() / 1000);
  const event = {
    id: 'event-one',
    type: 'payment.updated',
    mode: 'test',
    transaction: {
      id: 'one',
      subscriptionId: null,
      periodStart: null,
      periodEnd: null,
      bindingId: 'app',
      orderId: 'order',
      priceId: 'price',
      amount: 1200,
      currency: 'eur',
      feeAmount: 0,
      revision: 1,
      refundedAmount: 0,
      status: 'paid',
      checkoutUrl: null,
      deliveredAt: null,
    },
  };
  const body = JSON.stringify(event);
  const signature = `t=${timestamp},v1=${createHmac('sha256', token).update(`${timestamp}.${body}`).digest('hex')}`;

  await expect(platform.payments.verifyEvent(body, signature)).resolves.toEqual(event);
});

it('rejects a correctly signed callback from another environment', async () => {
  const platform = PHPSandbox.app({ env: base });
  const timestamp = Math.floor(Date.now() / 1000);
  const body = JSON.stringify({
    id: 'event-one',
    type: 'payment.updated',
    mode: 'live',
    transaction: {
      id: 'one',
      subscriptionId: null,
      periodStart: null,
      periodEnd: null,
      bindingId: 'app',
      orderId: 'order',
      priceId: 'price',
      amount: 1200,
      currency: 'eur',
      feeAmount: 0,
      revision: 1,
      refundedAmount: 0,
      status: 'paid',
      checkoutUrl: null,
      deliveredAt: null,
    },
  });
  const signature = `t=${timestamp},v1=${createHmac('sha256', token).update(`${timestamp}.${body}`).digest('hex')}`;

  await expect(platform.payments.verifyEvent(body, signature)).rejects.toThrow('mode');
});

it('rejects a forged callback signature', async () => {
  const platform = PHPSandbox.app({ env: base });
  const timestamp = Math.floor(Date.now() / 1000);

  await expect(platform.payments.verifyEvent('{}', `t=${timestamp},v1=${'0'.repeat(64)}`)).rejects.toThrow('signature');
});

it('rejects browser initialization even when a token is supplied', () => {
  vi.stubGlobal('window', {});
  vi.stubGlobal('document', {});

  expect(() => PHPSandbox.app({ env: base })).toThrow('trusted server');
});
