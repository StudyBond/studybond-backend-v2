import { createHmac } from 'crypto';
import { describe, expect, it } from 'vitest';
import {
  extractWebhookReference,
  verifyPaystackWebhookSignature
} from '../../modules/subscriptions/webhook-handler';

describe('subscription webhook handler', () => {
  it('accepts a valid Paystack signature and extracts the reference', () => {
    process.env.PAYSTACK_SECRET_KEY = 'unit-test-paystack-secret';
    const rawBody = JSON.stringify({
      event: 'charge.success',
      data: {
        reference: 'SBSUB-UNIT-1'
      }
    });
    const signature = createHmac('sha512', process.env.PAYSTACK_SECRET_KEY)
      .update(rawBody)
      .digest('hex');

    expect(() => verifyPaystackWebhookSignature(rawBody, signature)).not.toThrow();
    expect(extractWebhookReference(JSON.parse(rawBody))).toBe('SBSUB-UNIT-1');
  });

  it('rejects an invalid Paystack signature', () => {
    process.env.PAYSTACK_SECRET_KEY = 'unit-test-paystack-secret';
    const rawBody = JSON.stringify({
      event: 'charge.success',
      data: {
        reference: 'SBSUB-UNIT-2'
      }
    });

    expect(() => verifyPaystackWebhookSignature(rawBody, 'bad-signature')).toThrow();
  });
});
