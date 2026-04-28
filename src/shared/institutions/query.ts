import { z } from 'zod';

export const institutionCodeQueryValueSchema = z.string()
  .trim()
  .min(2, 'institutionCode must be at least 2 characters')
  .max(32, 'institutionCode cannot exceed 32 characters')
  .regex(/^[A-Za-z0-9_]+$/, 'institutionCode must be alphanumeric')
  .transform((value) => value.toUpperCase());

export const institutionScopeQuerySchema = z.object({
  institutionCode: institutionCodeQueryValueSchema.optional()
}).strict();

export type InstitutionScopeQueryInput = z.infer<typeof institutionScopeQuerySchema>;
