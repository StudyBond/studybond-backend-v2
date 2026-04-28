import { z } from 'zod';
import { ValidationError } from '../errors/ValidationError';

export function parsePositiveInt(value: string, fieldName: string): number {
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed <= 0) {
    throw new ValidationError(`${fieldName} must be a positive integer`);
  }
  return parsed;
}

export function parseOptionalPositiveInt(value: string | undefined, fallback: number, fieldName: string): number {
  if (!value) return fallback;
  return parsePositiveInt(value, fieldName);
}

export function parseBooleanString(value: string | undefined, fieldName: string): boolean | undefined {
  if (value === undefined) return undefined;
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new ValidationError(`${fieldName} must be "true" or "false"`);
}

export function parseWithSchema<T>(schema: z.ZodType<T>, input: unknown, message = 'Validation failed'): T {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new ValidationError(message, result.error.flatten());
  }
  return result.data;
}
