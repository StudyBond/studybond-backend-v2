import { z } from 'zod';
import { isoDateTimeSchema } from '../../shared/openapi/responses';

export const subscriptionSnapshotSchema = z.object({
  status: z.enum(['ACTIVE', 'EXPIRED', 'CANCELLED']),
  planType: z.string(),
  amountPaidNaira: z.number(),
  currency: z.string(),
  autoRenew: z.boolean(),
  startDate: isoDateTimeSchema,
  endDate: isoDateTimeSchema,
  daysRemaining: z.number().int(),
  lastPaymentReference: z.string().nullable()
}).strict();

export const subscriptionStatusPayloadSchema = z.object({
  isPremium: z.boolean(),
  planType: z.string(),
  priceNaira: z.number(),
  currency: z.string(),
  durationMonths: z.number().int().positive(),
  currentSubscription: subscriptionSnapshotSchema.nullable()
}).strict();

export const initiateSubscriptionPayloadSchema = z.object({
  reference: z.string(),
  checkoutUrl: z.string(),
  accessCode: z.string(),
  amountNaira: z.number(),
  currency: z.string(),
  planType: z.string(),
  durationMonths: z.number().int().positive(),
  autoRenew: z.boolean(),
  message: z.string()
}).strict();

export const verifySubscriptionPayloadSchema = z.object({
  activated: z.boolean(),
  paymentStatus: z.enum(['PENDING', 'SUCCESS', 'FAILED', 'ABANDONED', 'REVERSED']),
  message: z.string(),
  subscription: subscriptionSnapshotSchema.nullable()
}).strict();

export const cancelSubscriptionPayloadSchema = z.object({
  autoRenew: z.boolean(),
  message: z.string(),
  subscription: subscriptionSnapshotSchema.nullable()
}).strict();

export const subscriptionWebhookPayloadSchema = z.object({
  received: z.literal(true)
}).strict();
