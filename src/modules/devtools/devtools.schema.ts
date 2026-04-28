import { EmailType } from '@prisma/client';
import { z } from 'zod';

export const devToolsTokenHeadersSchema = z.object({
  'x-dev-tools-token': z.string().min(1).optional()
}).passthrough();

export const otpPreviewQuerySchema = z.object({
  email: z.string().email().optional(),
  emailType: z.nativeEnum(EmailType).optional(),
  limit: z.coerce.number().int().min(1).max(20).optional()
}).strict();
