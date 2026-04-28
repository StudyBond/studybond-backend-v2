import { z } from 'zod';

export const isoDateTimeSchema = z.string().datetime();

export const opaqueObjectSchema = z.object({}).passthrough();

export const paginationSchema = z.object({
  page: z.number().int().positive(),
  limit: z.number().int().positive(),
  total: z.number().int().nonnegative(),
  totalPages: z.number().int().nonnegative()
}).strict();

export const errorPayloadSchema = z.object({
  message: z.string(),
  statusCode: z.number().int(),
  code: z.string(),
  hint: z.string().optional(),
  details: z.unknown().optional(),
  stack: z.string().optional()
}).strict();

export const errorEnvelopeSchema = z.object({
  success: z.literal(false),
  error: errorPayloadSchema,
  requestId: z.string(),
  correlationId: z.string(),
  timestamp: isoDateTimeSchema
}).strict();

export function successEnvelopeSchema<T extends z.ZodTypeAny>(dataSchema: T) {
  return z.object({
    success: z.literal(true),
    data: dataSchema
  }).strict();
}

export const standardErrorResponses = {
  400: errorEnvelopeSchema,
  401: errorEnvelopeSchema,
  403: errorEnvelopeSchema,
  404: errorEnvelopeSchema,
  409: errorEnvelopeSchema,
  410: errorEnvelopeSchema,
  422: errorEnvelopeSchema,
  429: errorEnvelopeSchema,
  500: errorEnvelopeSchema,
  503: errorEnvelopeSchema
} as const;

export function withStandardErrorResponses<T extends Record<string | number, z.ZodTypeAny>>(responses: T) {
  return {
    ...standardErrorResponses,
    ...responses
  };
}
