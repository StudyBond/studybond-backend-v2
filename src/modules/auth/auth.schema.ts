import { z } from 'zod';
import { optionalInstitutionCodeSchema } from '../../shared/institutions/schema';

export const deviceFingerprintSchema = z.object({
  installationId: z.string().trim().min(1).max(128).optional(),
  deviceId: z.string().trim().min(1).max(128).optional(),
  deviceName: z.string().trim().min(1).max(120).optional(),
  platform: z.string().trim().max(64).optional(),
  platformVersion: z.string().trim().max(64).optional(),
  osName: z.string().trim().max(64).optional(),
  osVersion: z.string().trim().max(64).optional(),
  browserName: z.string().trim().max(64).optional(),
  browserVersion: z.string().trim().max(64).optional(),
  model: z.string().trim().max(64).optional(),
  manufacturer: z.string().trim().max(64).optional(),
  appVersion: z.string().trim().max(64).optional(),
  language: z.string().trim().max(32).optional(),
  timezone: z.string().trim().max(64).optional(),
  vendor: z.string().trim().max(128).optional(),
  fingerprintSeed: z.string().trim().max(256).optional(),
  userAgent: z.string().trim().max(1024).optional(),
  screenWidth: z.number().int().positive().max(10000).optional(),
  screenHeight: z.number().int().positive().max(10000).optional(),
  colorDepth: z.number().int().positive().max(128).optional(),
  pixelRatio: z.number().positive().max(10).optional(),
  deviceMemory: z.number().positive().max(1024).optional(),
  hardwareConcurrency: z.number().int().positive().max(256).optional(),
  maxTouchPoints: z.number().int().min(0).max(64).optional(),
}).strict();

export const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8, "Password must be at least 8 characters"),
  fullName: z.string().min(2),
  institutionCode: optionalInstitutionCodeSchema,
  aspiringCourse: z.string().optional(),
  targetScore: z.number().max(400).optional(),
  deviceId: z.string().trim().min(1).max(128).optional(),
  deviceName: z.string().trim().min(1).max(120).optional(),
  device: deviceFingerprintSchema.optional(),
});

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string(),
  deviceId: z.string().trim().min(1).max(128).optional(),
  deviceName: z.string().trim().min(1).max(120).optional(),
  device: deviceFingerprintSchema.optional(),
});

export const verifyOtpSchema = z.object({
  email: z.string().email(),
  deviceId: z.string().trim().min(1).max(128).optional(),
  deviceName: z.string().trim().min(1).max(120).optional(),
  device: deviceFingerprintSchema.optional(),
  otp: z.string().trim().regex(/^\d{6}$/, 'OTP must be a 6-digit code'),
});

export const refreshTokenSchema = z.object({
  refreshToken: z.string(),
});

export const forgotPasswordSchema = z.object({
  email: z.string().email()
});

export const resendVerificationOtpSchema = z.object({
  email: z.string().email()
}).strict();

export const resetPasswordSchema = z.object({
  email: z.string().email(),
  otp: z.string().trim().regex(/^\d{6}$/, 'OTP must be a 6-digit code'),
  newPassword: z.string().min(8, 'New password must be at least 8 characters').max(128),
  confirmNewPassword: z.string().min(8, 'Confirm password must be at least 8 characters').max(128)
}).strict().refine(
  (payload) => payload.newPassword === payload.confirmNewPassword,
  {
    path: ['confirmNewPassword'],
    message: 'Confirm password must match the new password.'
  }
).refine(
  (payload) => payload.newPassword !== payload.otp,
  {
    path: ['newPassword'],
    message: 'Your new password must not match the reset code.'
  }
);

export const resendResetPasswordOtpSchema = z.object({
  email: z.string().email()
}).strict();
