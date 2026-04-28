import { FastifyReply, FastifyRequest } from 'fastify';
import { parseWithSchema } from '../../shared/utils/validation';
import { streakCalendarQuerySchema } from './streaks.schema';
import { streaksService } from './streaks.service';

interface AuthenticatedRequestUser {
  userId: number;
}

export class StreaksController {
  getSummary = async (req: FastifyRequest, reply: FastifyReply) => {
    const userId = (req.user as AuthenticatedRequestUser).userId;
    const data = await streaksService.getSummary(userId);

    return reply.status(200).send({
      success: true,
      data
    });
  };

  getCalendar = async (req: FastifyRequest, reply: FastifyReply) => {
    const userId = (req.user as AuthenticatedRequestUser).userId;
    const query = parseWithSchema(streakCalendarQuerySchema, req.query, 'Invalid streak calendar query');
    const data = await streaksService.getCalendar(userId, query.days);

    return reply.status(200).send({
      success: true,
      data
    });
  };
}

export const streaksController = new StreaksController();
