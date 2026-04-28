import { z } from 'zod';
import {
  cancelSubscriptionSchema,
  initiateSubscriptionSchema,
  verifySubscriptionSchema
} from './subscriptions.schema';

export type InitiateSubscriptionInput = z.infer<typeof initiateSubscriptionSchema>;
export type VerifySubscriptionInput = z.infer<typeof verifySubscriptionSchema>;
export type CancelSubscriptionInput = z.infer<typeof cancelSubscriptionSchema>;

export interface SubscriptionRequestContext {
  ipAddress?: string;
  userAgent?: string;
  correlationId?: string;
  idempotencyKey?: string;
}

export type SubscriptionPaymentState =
  | 'PENDING'
  | 'SUCCESS'
  | 'FAILED'
  | 'ABANDONED'
  | 'REVERSED';

export interface SubscriptionSnapshot {
  status: 'ACTIVE' | 'EXPIRED' | 'CANCELLED';
  planType: string;
  amountPaidNaira: number;
  currency: string;
  autoRenew: boolean;
  startDate: string;
  endDate: string;
  daysRemaining: number;
  lastPaymentReference: string | null;
}

export interface SubscriptionStatusResponse {
  isPremium: boolean;
  planType: string;
  priceNaira: number;
  currency: string;
  durationMonths: number;
  currentSubscription: SubscriptionSnapshot | null;
}

export interface InitiateSubscriptionResponse {
  reference: string;
  checkoutUrl: string;
  accessCode: string;
  amountNaira: number;
  currency: string;
  planType: string;
  durationMonths: number;
  autoRenew: boolean;
  message: string;
}

export interface VerifySubscriptionResponse {
  activated: boolean;
  paymentStatus: SubscriptionPaymentState;
  message: string;
  subscription: SubscriptionSnapshot | null;
}

export interface CancelSubscriptionResponse {
  autoRenew: boolean;
  message: string;
  subscription: SubscriptionSnapshot | null;
}

export interface SubscriptionWebhookResponse {
  received: true;
}
