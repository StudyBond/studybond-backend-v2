import { createHmac, timingSafeEqual } from 'crypto';
import { AppError } from '../../shared/errors/AppError';

export interface PaystackWebhookEnvelope {
  event?: string;
  data?: {
    reference?: string;
    [key: string]: unknown;
  };
}

export interface RawWebhookBody<T> {
  rawBody: string;
  parsedBody: T;
}

function toBuffer(value: string): Buffer {
  return Buffer.from(value, 'utf8');
}

export function verifyPaystackWebhookSignature(rawBody: string, signature: string | undefined): void {
  const secretKey = process.env.PAYSTACK_SECRET_KEY?.trim();
  if (!secretKey) {
    throw new AppError(
      'Subscriptions are not available because the payment provider is not configured yet.',
      503,
      'SUBSCRIPTION_PROVIDER_NOT_CONFIGURED'
    );
  }

  const normalizedSignature = signature?.trim();
  if (!normalizedSignature) {
    throw new AppError(
      'The payment callback signature is missing.',
      401,
      'SUBSCRIPTION_WEBHOOK_SIGNATURE_INVALID'
    );
  }

  const expectedSignature = createHmac('sha512', secretKey).update(rawBody).digest('hex');
  const providedBuffer = toBuffer(normalizedSignature);
  const expectedBuffer = toBuffer(expectedSignature);

  if (
    providedBuffer.length !== expectedBuffer.length ||
    !timingSafeEqual(providedBuffer, expectedBuffer)
  ) {
    throw new AppError(
      'The payment callback signature is invalid.',
      401,
      'SUBSCRIPTION_WEBHOOK_SIGNATURE_INVALID'
    );
  }
}

export function extractWebhookReference(payload: unknown): string | null {
  const event = payload as PaystackWebhookEnvelope;
  const reference = event?.data?.reference;
  if (typeof reference !== 'string' || reference.trim().length === 0) {
    return null;
  }

  return reference.trim();
}
