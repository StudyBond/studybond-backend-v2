import { z } from 'zod';

export const institutionCodeSchema = z.string()
  .trim()
  .min(2, 'Institution code must be at least 2 characters.')
  .max(32, 'Institution code must be at most 32 characters.')
  .transform((value) => value.toUpperCase());

export const optionalInstitutionCodeSchema = institutionCodeSchema.optional();

export type InstitutionCodeInput = z.infer<typeof institutionCodeSchema>;
