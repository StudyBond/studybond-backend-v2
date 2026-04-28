import { z } from 'zod';

export const initiateSubscriptionSchema = z.object({
  autoRenew: z.boolean().optional()
}).strict();

export const verifySubscriptionSchema = z.object({
  reference: z.string().trim().min(6).max(120).regex(/^[A-Za-z0-9._-]+$/, 'Reference contains invalid characters')
}).strict();

export const cancelSubscriptionSchema = z.object({
  reason: z.string().trim().min(3).max(200).optional()
}).strict();
