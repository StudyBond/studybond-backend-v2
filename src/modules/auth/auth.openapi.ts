import { z } from 'zod';
import { opaqueObjectSchema } from '../../shared/openapi/responses';

export const authUserViewSchema = z.object({
  id: z.number().int().positive(),
  email: z.email(),
  fullName: z.string(),
  isPremium: z.boolean(),
  role: z.string()
}).strict();

export const authSuccessPayloadSchema = z.object({
  user: authUserViewSchema,
  accessToken: z.string(),
  refreshToken: z.string(),
  requiresOTP: z.literal(false),
  message: z.string().optional()
}).strict();

export const authOtpChallengePayloadSchema = z.object({
  requiresOTP: z.literal(true),
  verificationType: z.enum(['EMAIL_VERIFICATION', 'DEVICE_REGISTRATION']),
  message: z.string(),
  otpExpiresAt: z.string().optional(),
  resendAvailableAt: z.string().optional()
}).strict();

export const authMessagePayloadSchema = z.object({
  message: z.string()
}).passthrough();

export const authVerificationResendPayloadSchema = z.object({
  message: z.string(),
  otpExpiresAt: z.string().optional(),
  resendAvailableAt: z.string().optional()
}).strict();

export const authRefreshPayloadSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string()
}).passthrough();

export const authMePayloadSchema = z.object({
  user: opaqueObjectSchema
}).passthrough();
