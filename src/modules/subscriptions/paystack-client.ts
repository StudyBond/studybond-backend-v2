import { PaymentProvider, Prisma } from '@prisma/client';
import { z } from 'zod';
import { AppError } from '../../shared/errors/AppError';
import { SUBSCRIPTION_CONFIG } from '../../config/constants';
import {
  PaymentProviderInitializeInput,
  PaymentProviderInitializeResult,
  PaymentProviderVerificationResult,
  SubscriptionPaymentProvider
} from './payment-provider';
import {
  extractWebhookReference,
  verifyPaystackWebhookSignature
} from './webhook-handler';

const PAYSTACK_BASE_URL = 'https://api.paystack.co';

interface PaystackApiResponse<T> {
  status: boolean;
  message: string;
  data: T;
}

export const paystackWebhookHeadersSchema = z.object({
  'x-paystack-signature': z.string().trim().min(32)
}).passthrough();

interface PaystackInitializeData {
  authorization_url: string;
  access_code: string;
  reference: string;
}

interface PaystackAuthorization {
  authorization_code?: string;
  reusable?: boolean;
  signature?: string;
}

interface PaystackCustomer {
  email?: string;
  customer_code?: string;
}

interface PaystackVerifyData {
  id?: number;
  status: string;
  reference: string;
  amount: number;
  currency: string;
  channel?: string;
  gateway_response?: string;
  paid_at?: string | null;
  created_at?: string | null;
  metadata?: unknown;
  customer?: PaystackCustomer | null;
  authorization?: PaystackAuthorization | null;
}

function parseJsonIfNeeded(value: unknown): unknown {
  if (typeof value !== 'string') return value;

  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function mapProviderStatus(status: string): PaymentProviderVerificationResult['paymentStatus'] {
  const normalized = status.trim().toLowerCase();

  if (normalized === 'success') return 'SUCCESS';
  if (normalized === 'failed') return 'FAILED';
  if (normalized === 'abandoned') return 'ABANDONED';
  if (normalized === 'reversed') return 'REVERSED';
  return 'PENDING';
}

function asMetadataRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  return value as Record<string, unknown>;
}

export class PaystackClient implements SubscriptionPaymentProvider {
  readonly provider: PaymentProvider = 'PAYSTACK';
  readonly displayName = 'Paystack';
  readonly webhookHeadersSchema = paystackWebhookHeadersSchema;

  private getSecretKey(): string {
    const secretKey = process.env.PAYSTACK_SECRET_KEY?.trim();
    if (!secretKey) {
      throw new AppError(
        'Subscriptions are not available because the payment provider is not configured yet.',
        503,
        'SUBSCRIPTION_PROVIDER_NOT_CONFIGURED'
      );
    }
    return secretKey;
  }

  private async request<T>(path: string, init: RequestInit): Promise<PaystackApiResponse<T>> {
    const secretKey = this.getSecretKey();

    let response: Response;
    try {
      response = await fetch(`${PAYSTACK_BASE_URL}${path}`, {
        ...init,
        headers: {
          Authorization: `Bearer ${secretKey}`,
          'Content-Type': 'application/json',
          ...(init.headers || {})
        },
        signal: AbortSignal.timeout(SUBSCRIPTION_CONFIG.PROVIDER_TIMEOUT_MS)
      });
    } catch (error) {
      throw new AppError(
        'We could not reach the payment service right now.',
        502,
        'SUBSCRIPTION_PROVIDER_UNAVAILABLE',
        { cause: error instanceof Error ? error.message : String(error) }
      );
    }

    let payload: PaystackApiResponse<T> | null = null;
    try {
      payload = await response.json() as PaystackApiResponse<T>;
    } catch {
      throw new AppError(
        'The payment service returned an unreadable response.',
        502,
        'SUBSCRIPTION_PROVIDER_INVALID_RESPONSE'
      );
    }

    if (!response.ok || !payload?.status) {
      const message = payload?.message || 'Payment request failed.';
      throw new AppError(message, response.status || 502, 'SUBSCRIPTION_PROVIDER_REQUEST_FAILED');
    }

    return payload;
  }

  async initializeTransaction(input: PaymentProviderInitializeInput): Promise<PaymentProviderInitializeResult> {
    const response = await this.request<PaystackInitializeData>('/transaction/initialize', {
      method: 'POST',
      body: JSON.stringify({
        email: input.email,
        amount: input.amountMinor,
        reference: input.reference,
        callback_url: input.callbackUrl,
        currency: input.currency,
        metadata: JSON.stringify(input.metadata)
      })
    });

    return {
      provider: this.provider,
      reference: response.data.reference,
      checkoutUrl: response.data.authorization_url,
      accessCode: response.data.access_code,
      providerPayload: response.data as unknown as Prisma.InputJsonValue
    };
  }

  async verifyTransaction(reference: string): Promise<PaymentProviderVerificationResult> {
    const response = await this.request<PaystackVerifyData>(`/transaction/verify/${encodeURIComponent(reference)}`, {
      method: 'GET'
    });

    const parsedMetadata = parseJsonIfNeeded(response.data?.metadata);

    return {
      provider: this.provider,
      reference: response.data.reference,
      paymentStatus: mapProviderStatus(response.data.status),
      amountMinor: response.data.amount,
      currency: response.data.currency,
      channel: response.data.channel || null,
      gatewayResponse: response.data.gateway_response || null,
      customerEmail: response.data.customer?.email || null,
      customerCode: response.data.customer?.customer_code || null,
      authorizationCode: response.data.authorization?.authorization_code || null,
      authorizationReusable: Boolean(response.data.authorization?.reusable),
      authorizationSignature: response.data.authorization?.signature || null,
      metadata: asMetadataRecord(parsedMetadata),
      paidAt: response.data.paid_at
        ? new Date(response.data.paid_at)
        : (response.data.created_at ? new Date(response.data.created_at) : null),
      providerPayload: {
        ...response.data,
        metadata: parsedMetadata
      } as unknown as Prisma.InputJsonValue
    };
  }

  verifyWebhookSignature(rawBody: string, signature: string | undefined): void {
    verifyPaystackWebhookSignature(rawBody, signature);
  }

  extractWebhookReference(payload: unknown): string | null {
    return extractWebhookReference(payload);
  }

  extractWebhookSignature(headers: Record<string, unknown>): string | undefined {
    const value = headers['x-paystack-signature'];
    return typeof value === 'string' ? value : undefined;
  }
}

export const paystackClient = new PaystackClient();
