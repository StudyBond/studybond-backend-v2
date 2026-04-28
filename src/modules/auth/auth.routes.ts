import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AuthController } from './auth.controller';
import {
  forgotPasswordSchema,
  loginSchema,
  refreshTokenSchema,
  registerSchema,
  resendVerificationOtpSchema,
  resendResetPasswordOtpSchema,
  resetPasswordSchema,
  verifyOtpSchema
} from './auth.schema';
import {
  authMePayloadSchema,
  authMessagePayloadSchema,
  authOtpChallengePayloadSchema,
  authRefreshPayloadSchema,
  authSuccessPayloadSchema,
  authVerificationResendPayloadSchema
} from './auth.openapi';
import { withStandardErrorResponses } from '../../shared/openapi/responses';

export async function authRoutes(app: FastifyInstance) {
  const controller = new AuthController();
  const loginRateMax = Number.parseInt(process.env.AUTH_LOGIN_RATE_LIMIT_MAX || '8', 10);
  const otpRateMax = Number.parseInt(process.env.AUTH_VERIFY_OTP_RATE_LIMIT_MAX || '12', 10);
  const refreshRateMax = Number.parseInt(process.env.AUTH_REFRESH_RATE_LIMIT_MAX || '40', 10);
  const registerRateMax = Number.parseInt(process.env.AUTH_REGISTER_RATE_LIMIT_MAX || '6', 10);
  const resendVerificationRateMax = Number.parseInt(process.env.AUTH_RESEND_VERIFICATION_RATE_LIMIT_MAX || '5', 10);
  const forgotPasswordRateMax = Number.parseInt(process.env.AUTH_FORGOT_PASSWORD_RATE_LIMIT_MAX || '5', 10);
  const resendResetPasswordRateMax = Number.parseInt(process.env.AUTH_RESEND_RESET_PASSWORD_RATE_LIMIT_MAX || '5', 10);
  const resetPasswordRateMax = Number.parseInt(process.env.AUTH_RESET_PASSWORD_RATE_LIMIT_MAX || '10', 10);

  app.post('/signup', {
    config: {
      rateLimit: {
        max: registerRateMax,
        timeWindow: '1 minute'
      }
    },
    schema: {
      body: registerSchema,
      tags: ['Auth'],
      summary: 'Register account',
      description: 'Register a new user account and send an email verification OTP',
      response: withStandardErrorResponses({
        201: authOtpChallengePayloadSchema
      })
    }
  }, controller.register);

  app.post('/login', {
    config: {
      rateLimit: {
        max: loginRateMax,
        timeWindow: '1 minute'
      }
    },
    schema: {
      body: loginSchema,
      tags: ['Auth'],
      summary: 'Login',
      description: 'Login user. Premium device registration may require OTP approval.',
      response: withStandardErrorResponses({
        200: z.union([authSuccessPayloadSchema, authOtpChallengePayloadSchema])
      })
    }
  }, controller.login);

  app.post('/verify-otp', {
    config: {
      rateLimit: {
        max: otpRateMax,
        timeWindow: '1 minute'
      }
    },
    schema: {
      body: verifyOtpSchema,
      tags: ['Auth'],
      summary: 'Verify OTP',
      description: 'Verify an email OTP or a premium device OTP depending on auth state',
      response: withStandardErrorResponses({
        200: z.union([authSuccessPayloadSchema, authMessagePayloadSchema])
      })
    }
  }, controller.verifyOtp);

  app.post('/resend-verification-otp', {
    config: {
      rateLimit: {
        max: resendVerificationRateMax,
        timeWindow: '1 minute'
      }
    },
    schema: {
      body: resendVerificationOtpSchema,
      tags: ['Auth'],
      summary: 'Resend verification OTP',
      description: 'Request a fresh email verification OTP for a pending unverified account.',
      response: withStandardErrorResponses({
        200: authVerificationResendPayloadSchema
      })
    }
  }, controller.resendVerificationOtp);

  app.post('/forgot-password', {
    config: {
      rateLimit: {
        max: forgotPasswordRateMax,
        timeWindow: '1 minute'
      }
    },
    schema: {
      body: forgotPasswordSchema,
      tags: ['Auth'],
      summary: 'Forgot password',
      description: 'Request a password reset OTP. Response is generic to avoid account enumeration.',
      response: withStandardErrorResponses({
        200: authMessagePayloadSchema
      })
    }
  }, controller.forgotPassword);

  app.post('/resend-reset-otp', {
    config: {
      rateLimit: {
        max: resendResetPasswordRateMax,
        timeWindow: '1 minute'
      }
    },
    schema: {
      body: resendResetPasswordOtpSchema,
      tags: ['Auth'],
      summary: 'Resend reset OTP',
      description: 'Request a fresh password reset OTP for an existing pending reset challenge. Response is generic to avoid account enumeration.',
      response: withStandardErrorResponses({
        200: authMessagePayloadSchema
      })
    }
  }, controller.resendResetPasswordOtp);

  app.post('/reset-password', {
    config: {
      rateLimit: {
        max: resetPasswordRateMax,
        timeWindow: '1 minute'
      }
    },
    schema: {
      body: resetPasswordSchema,
      tags: ['Auth'],
      summary: 'Reset password',
      description: 'Reset a password using a valid password reset OTP. This invalidates all active sessions.',
      response: withStandardErrorResponses({
        200: authMessagePayloadSchema
      })
    }
  }, controller.resetPassword);

  app.post('/refresh', {
    config: {
      rateLimit: {
        max: refreshRateMax,
        timeWindow: '1 minute'
      }
    },
    schema: {
      body: refreshTokenSchema,
      tags: ['Auth'],
      summary: 'Refresh access token',
      description: 'Refresh access token using refresh token',
      response: withStandardErrorResponses({
        200: authRefreshPayloadSchema
      })
    }
  }, controller.refreshToken);

  app.get('/me', {
    preValidation: [app.authenticate], // Assuming we have this decorator from app.ts setup
    schema: {
      tags: ['Auth'],
      summary: 'Get current auth session',
      description: 'Returns the authenticated user and session context for the current access token.',
      security: [{ bearerAuth: [] }],
      response: withStandardErrorResponses({
        200: authMePayloadSchema
      })
    }
  }, controller.me);

  app.post('/logout', {
    preValidation: [app.authenticate],
    schema: {
      tags: ['Auth'],
      summary: 'Logout current session',
      description: 'Logout the current session while keeping the registered device record intact.',
      security: [{ bearerAuth: [] }],
      response: withStandardErrorResponses({
        200: authMessagePayloadSchema
      })
    }
  }, controller.logout);
}
