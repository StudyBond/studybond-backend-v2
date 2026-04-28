import { z } from 'zod';
import {
  registerSchema,
  loginSchema,
  verifyOtpSchema,
  refreshTokenSchema,
  deviceFingerprintSchema,
  forgotPasswordSchema,
  resendVerificationOtpSchema,
  resendResetPasswordOtpSchema,
  resetPasswordSchema
} from './auth.schema';

// TypeScript types inferred from schemas
export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type VerifyOtpInput = z.infer<typeof verifyOtpSchema>;
export type RefreshTokenInput = z.infer<typeof refreshTokenSchema>;
export type DeviceFingerprint = z.infer<typeof deviceFingerprintSchema>;
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;
export type ResendVerificationOtpInput = z.infer<typeof resendVerificationOtpSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
export type ResendResetPasswordOtpInput = z.infer<typeof resendResetPasswordOtpSchema>;

export interface AuthRequestContext {
  ipAddress?: string;
  userAgent?: string;
}

export interface AuthUserView {
  id: number;
  email: string;
  fullName: string;
  isPremium: boolean;
  role: string;
}

export interface AuthSuccessResponse {
  user: AuthUserView;
  accessToken: string;
  refreshToken: string;
  requiresOTP: false;
  message?: string;
}

export interface AuthOtpChallengeResponse {
  requiresOTP: true;
  verificationType: 'EMAIL_VERIFICATION' | 'DEVICE_REGISTRATION';
  message: string;
  otpExpiresAt?: string;
  resendAvailableAt?: string;
}

export interface AuthMessageResponse {
  message: string;
}

export interface AuthVerificationResendResponse extends AuthMessageResponse {
  otpExpiresAt?: string;
  resendAvailableAt?: string;
}

// SERVICE RESPONSE TYPES
export type AuthResponse = AuthSuccessResponse | AuthOtpChallengeResponse;
