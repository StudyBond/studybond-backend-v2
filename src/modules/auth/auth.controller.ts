// src/modules/auth/auth.controller.ts
import { FastifyReply, FastifyRequest } from 'fastify';
import { AuthService } from './auth.service';
import { RegisterInput, LoginInput, VerifyOtpInput } from './auth.types';

export class AuthController {
  private authService: AuthService;

  constructor() {
    this.authService = new AuthService();
  }

  register = async (req: FastifyRequest<{ Body: RegisterInput }>, reply: FastifyReply) => {
    const result = await this.authService.register(req.body);
    return reply.code(201).send(result);
  };

  login = async (req: FastifyRequest<{ Body: LoginInput }>, reply: FastifyReply) => {
    const result = await this.authService.login(req.body);

    if (result.requiresOTP) {
      return reply.code(200).send(result); // 200 OK, but needs further action
    }

    return reply.code(200).send(result);
  };

  verifyOtp = async (req: FastifyRequest<{ Body: VerifyOtpInput }>, reply: FastifyReply) => {
    const result = await this.authService.verifyDeviceOtp(req.body);
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
    const user = req.user as { userId: number; deviceId: string };
    const result = await this.authService.logout(user.userId, user.deviceId);
    return reply.code(200).send(result);
  };
}