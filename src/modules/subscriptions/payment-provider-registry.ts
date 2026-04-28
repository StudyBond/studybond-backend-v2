import { AppError } from '../../shared/errors/AppError';
import { SUBSCRIPTION_CONFIG } from '../../config/constants';
import { SubscriptionPaymentProvider } from './payment-provider';
import { paystackClient } from './paystack-client';

const providers: Partial<Record<'PAYSTACK' | 'MONNIFY', SubscriptionPaymentProvider>> = {
  PAYSTACK: paystackClient
};

export function getSubscriptionPaymentProvider(): SubscriptionPaymentProvider {
  const configured = SUBSCRIPTION_CONFIG.PAYMENT_PROVIDER as 'PAYSTACK' | 'MONNIFY';
  const provider = providers[configured];

  if (!provider) {
    throw new AppError(
      `The configured payment provider (${configured}) is not supported by this deployment yet.`,
      503,
      'SUBSCRIPTION_PROVIDER_NOT_SUPPORTED'
    );
  }

  return provider;
}
