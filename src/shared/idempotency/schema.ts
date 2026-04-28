import { z } from 'zod';

export const optionalIdempotencyHeadersSchema = z.object({
  'idempotency-key': z.string().trim().min(8, 'Idempotency-Key must be at least 8 characters').optional()
}).passthrough();

export const requiredIdempotencyHeadersSchema = z.object({
  'idempotency-key': z.string().trim().min(8, 'Idempotency-Key must be at least 8 characters')
}).passthrough();
