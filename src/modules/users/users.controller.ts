import { FastifyReply, FastifyRequest } from 'fastify';
import { parseWithSchema } from '../../shared/utils/validation';
import { changePasswordSchema, deleteAccountSchema, updateProfileSchema, userStatsQuerySchema } from './users.schema';
import { usersService } from './users.service';

interface AuthenticatedRequestUser {
  userId: number;
  sessionId: string;
  deviceId: string;
}

export class UsersController {
  private serializeJsonDates<T>(value: T): T {
    if (value instanceof Date) {
      return value.toISOString() as T;
    }

    if (Array.isArray(value)) {
      return value.map((item) => this.serializeJsonDates(item)) as T;
    }

    if (value && typeof value === 'object') {
      const entries = Object.entries(value as Record<string, unknown>).map(([key, entryValue]) => [
        key,
        this.serializeJsonDates(entryValue)
      ]);

      return Object.fromEntries(entries) as T;
    }

    return value;
  }

  getProfile = async (req: FastifyRequest, reply: FastifyReply) => {
    const userId = (req.user as AuthenticatedRequestUser).userId;
    const data = await usersService.getProfile(userId);

    return reply.status(200).send({
      success: true,
      data: this.serializeJsonDates(data)
    });
  };

  updateProfile = async (req: FastifyRequest, reply: FastifyReply) => {
    const userId = (req.user as AuthenticatedRequestUser).userId;
    const payload = parseWithSchema(updateProfileSchema, req.body, 'Invalid profile update payload');
    const data = await usersService.updateProfile(userId, payload);

    return reply.status(200).send({
      success: true,
      data: this.serializeJsonDates(data)
    });
  };

  getStats = async (req: FastifyRequest, reply: FastifyReply) => {
    const userId = (req.user as AuthenticatedRequestUser).userId;
    const query = parseWithSchema(userStatsQuerySchema, req.query ?? {}, 'Invalid user stats query');
    const data = await usersService.getStats(userId, query.institutionCode);

    return reply.status(200).send({
      success: true,
      data
    });
  };

  getAchievements = async (req: FastifyRequest, reply: FastifyReply) => {
    const userId = (req.user as AuthenticatedRequestUser).userId;
    const data = await usersService.getAchievements(userId);

    return reply.status(200).send({
      success: true,
      data: this.serializeJsonDates(data)
    });
  };

  getSecurityOverview = async (req: FastifyRequest, reply: FastifyReply) => {
    const user = req.user as AuthenticatedRequestUser;
    const data = await usersService.getSecurityOverview(user.userId, user.sessionId, user.deviceId);

    return reply.status(200).send({
      success: true,
      data: this.serializeJsonDates(data)
    });
  };

  changePassword = async (req: FastifyRequest, reply: FastifyReply) => {
    const user = req.user as AuthenticatedRequestUser;
    const payload = parseWithSchema(changePasswordSchema, req.body, 'Invalid password change payload');
    const data = await usersService.changePassword(
      user.userId,
      payload.currentPassword,
      payload.newPassword,
      user.sessionId,
      user.deviceId,
      {
        ipAddress: req.ip,
        userAgent: req.headers['user-agent']
      }
    );

    return reply.status(200).send({
      success: true,
      data
    });
  };

  deleteAccount = async (req: FastifyRequest, reply: FastifyReply) => {
    const userId = (req.user as AuthenticatedRequestUser).userId;
    const payload = parseWithSchema(deleteAccountSchema, req.body, 'Invalid account deletion payload');
    const data = await usersService.deleteAccount(userId, payload.password);

    return reply.status(200).send({
      success: true,
      data
    });
  };
}

export const usersController = new UsersController();
