import { PaymentProvider, Prisma } from '@prisma/client';
import { ZodTypeAny } from 'zod';
import { SubscriptionPaymentState } from './subscriptions.types';

export interface PaymentProviderInitializeInput {
  email: string;
  amountMinor: number;
  currency: string;
  reference: string;
  callbackUrl?: string;
  metadata: Record<string, unknown>;
}

export interface PaymentProviderInitializeResult {
  provider: PaymentProvider;
  reference: string;
  checkoutUrl: string;
  accessCode: string;
  providerPayload: Prisma.InputJsonValue;
}

export interface PaymentProviderVerificationResult {
  provider: PaymentProvider;
  reference: string;
  paymentStatus: SubscriptionPaymentState;
  amountMinor: number;
  currency: string;
  channel: string | null;
  gatewayResponse: string | null;
  customerEmail: string | null;
  customerCode: string | null;
  authorizationCode: string | null;
  authorizationReusable: boolean;
  authorizationSignature: string | null;
  metadata: Record<string, unknown> | null;
  paidAt: Date | null;
  providerPayload: Prisma.InputJsonValue;
}

export interface SubscriptionPaymentProvider {
  readonly provider: PaymentProvider;
  readonly displayName: string;
  readonly webhookHeadersSchema: ZodTypeAny;
  initializeTransaction(input: PaymentProviderInitializeInput): Promise<PaymentProviderInitializeResult>;
  verifyTransaction(reference: string): Promise<PaymentProviderVerificationResult>;
  verifyWebhookSignature(rawBody: string, signature: string | undefined): void;
  extractWebhookReference(payload: unknown): string | null;
  extractWebhookSignature(headers: Record<string, unknown>): string | undefined;
}

export interface RawWebhookBody<T = unknown> {
  rawBody: string;
  parsedBody: T;
}
