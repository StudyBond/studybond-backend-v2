// src/modules/auth/auth.controller.ts
import { FastifyReply, FastifyRequest } from 'fastify';
import { AuthService } from './auth.service';
import {
  ForgotPasswordInput,
  LoginInput,
  RegisterInput,
  ResendVerificationOtpInput,
  ResendResetPasswordOtpInput,
  ResetPasswordInput,
  VerifyOtpInput
} from './auth.types';

export class AuthController {
  private authService: AuthService;

  constructor() {
    this.authService = new AuthService();
  }

  private getRequestContext(req: FastifyRequest) {
    return {
      ipAddress: req.ip || (req.headers['x-forwarded-for'] as string | undefined),
      userAgent: req.headers['user-agent']
    };
  }

  register = async (req: FastifyRequest<{ Body: RegisterInput }>, reply: FastifyReply) => {
    const result = await this.authService.register(req.body, this.getRequestContext(req));
    return reply.code(201).send(result);
  };

  login = async (req: FastifyRequest<{ Body: LoginInput }>, reply: FastifyReply) => {
    const result = await this.authService.login(req.body, this.getRequestContext(req));

    if (result.requiresOTP) {
      return reply.code(200).send(result); // 200 OK, but needs further action
    }

    return reply.code(200).send(result);
  };

  verifyOtp = async (req: FastifyRequest<{ Body: VerifyOtpInput }>, reply: FastifyReply) => {
    const result = await this.authService.verifyOtp(req.body, this.getRequestContext(req));
    return reply.code(200).send(result);
  };

  resendVerificationOtp = async (
    req: FastifyRequest<{ Body: ResendVerificationOtpInput }>,
    reply: FastifyReply
  ) => {
    const result = await this.authService.resendVerificationOtp(req.body, this.getRequestContext(req));
    return reply.code(200).send(result);
  };

  forgotPassword = async (req: FastifyRequest<{ Body: ForgotPasswordInput }>, reply: FastifyReply) => {
    const result = await this.authService.forgotPassword(req.body, this.getRequestContext(req));
    return reply.code(200).send(result);
  };

  resendResetPasswordOtp = async (
    req: FastifyRequest<{ Body: ResendResetPasswordOtpInput }>,
    reply: FastifyReply
  ) => {
    const result = await this.authService.resendResetPasswordOtp(req.body, this.getRequestContext(req));
    return reply.code(200).send(result);
  };

  resetPassword = async (req: FastifyRequest<{ Body: ResetPasswordInput }>, reply: FastifyReply) => {
    const result = await this.authService.resetPassword(req.body, this.getRequestContext(req));
    return reply.code(200).send(result);
  };

  refreshToken = async (req: FastifyRequest<{ Body: { refreshToken: string } }>, reply: FastifyReply) => {
    const result = await this.authService.refreshToken(req.body.refreshToken);
    return reply.code(200).send(result);
  };

  // Example protected route handler
  me = async (req: FastifyRequest, reply: FastifyReply) => {
    return reply.send({ user: req.user });
  }

  logout = async (req: FastifyRequest, reply: FastifyReply) => {
    // req.user is populated by fastify-jwt
    const user = req.user as { userId: number; sessionId: string };
    const result = await this.authService.logout(user.userId, user.sessionId);
    return reply.code(200).send(result);
  };
}
