import { FastifyReply, FastifyRequest } from 'fastify';
import { parseWithSchema } from '../../shared/utils/validation';
import { leaderboardQuerySchema } from './leaderboard.schema';
import { LeaderboardService } from './leaderboard.service';

interface AuthenticatedRequestUser {
  userId: number;
}

export class LeaderboardController {
  private readonly leaderboardService: LeaderboardService;

  constructor(leaderboardService: LeaderboardService) {
    this.leaderboardService = leaderboardService;
  }

  getWeeklyLeaderboard = async (req: FastifyRequest, reply: FastifyReply) => {
    const query = parseWithSchema(leaderboardQuerySchema, req.query, 'Invalid leaderboard query');
    const userId = (req.user as AuthenticatedRequestUser).userId;

    const data = await this.leaderboardService.getWeeklyLeaderboard(
      userId,
      query.institutionCode,
      query.limit
    );
    return reply.status(200).send({
      success: true,
      data
    });
  };

  getAllTimeLeaderboard = async (req: FastifyRequest, reply: FastifyReply) => {
    const query = parseWithSchema(leaderboardQuerySchema, req.query, 'Invalid leaderboard query');
    const userId = (req.user as AuthenticatedRequestUser).userId;

    const data = await this.leaderboardService.getAllTimeLeaderboard(
      userId,
      query.institutionCode,
      query.limit
    );
    return reply.status(200).send({
      success: true,
      data
    });
  };

  getMyRank = async (req: FastifyRequest, reply: FastifyReply) => {
    const query = parseWithSchema(leaderboardQuerySchema, req.query, 'Invalid leaderboard query');
    const userId = (req.user as AuthenticatedRequestUser).userId;
    const data = await this.leaderboardService.getMyRank(userId, query.institutionCode);

    return reply.status(200).send({
      success: true,
      data
    });
  };
}
