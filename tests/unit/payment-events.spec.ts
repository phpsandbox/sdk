import { createHmac } from 'node:crypto';
import { expect, it } from 'vitest';
import { verifyPaymentEvent } from '../../src/payments.js';

const token = `hpay_${'a'.repeat(64)}`;
const timestamp = '1792350000';
const event = {
  id: 'purchase:1',
  type: 'payment.updated',
  mode: 'test',
  transaction: {
    subscriptionId: null,
    periodStart: null,
    periodEnd: null,
    id: 'purchase',
    bindingId: 'binding',
    orderId: 'course',
    priceId: 'price',
    amount: 4900,
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

it('verifies the original signed event with its mode and transaction revision', async () => {
  await expect(verifyPaymentEvent(body, signature, token, 'test', Number(timestamp) * 1000)).resolves.toEqual(event);
});
it('rejects forged content before trusting a purchase', async () => {
  await expect(
    verifyPaymentEvent(body.replace('4900', '100'), signature, token, 'test', Number(timestamp) * 1000)
  ).rejects.toThrow('Invalid payment signature');
});
it('rejects stale event signatures and mode mismatches', async () => {
  await expect(verifyPaymentEvent(body, signature, token, 'test', Number(timestamp) * 1000 + 300001)).rejects.toThrow('expired');
  await expect(verifyPaymentEvent(body, signature, token, 'live', Number(timestamp) * 1000)).rejects.toThrow('mode');
});

it('refuses webhook verification when the application credential is missing', async () => {
  const emptySignature = `t=${timestamp},v1=${createHmac('sha256', '').update(`${timestamp}.${body}`).digest('hex')}`;
  await expect(verifyPaymentEvent(body, emptySignature, '', 'test', Number(timestamp) * 1000)).rejects.toThrow('credential');
});
