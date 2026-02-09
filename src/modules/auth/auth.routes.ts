import { FastifyInstance } from 'fastify';
import { AuthController } from './auth.controller';
import { registerSchema, loginSchema, verifyOtpSchema, refreshTokenSchema } from './auth.schema';

export async function authRoutes(app: FastifyInstance) {
  const controller = new AuthController();

  app.post('/register', {
    schema: {
      body: registerSchema,
      tags: ['Auth'],
      description: 'Register a new user and device',
    }
  }, controller.register);

  app.post('/login', {
    schema: {
      body: loginSchema,
      tags: ['Auth'],
      description: 'Login user (may return requiresOTP: true)',
    }
  }, controller.login);

  app.post('/verify-otp', {
    schema: {
      body: verifyOtpSchema,
      tags: ['Auth'],
      description: 'Verify new device with email OTP',
    }
  }, controller.verifyOtp);

  app.post('/refresh', {
    schema: {
      body: refreshTokenSchema,
      tags: ['Auth'],
      description: 'Refresh access token using refresh token'
    }
  }, controller.refreshToken);

  app.get('/me', {
    preValidation: [app.authenticate], // Assuming we have this decorator from app.ts setup
  }, controller.me);

  app.post('/logout', {
    preValidation: [app.authenticate],
    schema: {
      // tags: ['Auth'],
      // description: 'Logout current session (keeps device registered)',
    }
  }, controller.logout);
}