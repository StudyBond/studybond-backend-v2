import { describe, expect, it } from 'vitest';
import { getSubscriptionPaymentProvider } from '../../modules/subscriptions/payment-provider-registry';

describe('subscription payment provider registry', () => {
  it('returns the Paystack adapter by default', () => {
    const provider = getSubscriptionPaymentProvider();

    expect(provider.provider).toBe('PAYSTACK');
    expect(provider.displayName).toBe('Paystack');
  });
});
