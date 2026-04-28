import { FastifyInstance } from 'fastify';
import { LeaderboardService } from '../modules/leaderboard/leaderboard.service';

export async function runWeeklyLeaderboardReset(app: FastifyInstance): Promise<void> {
  const service = new LeaderboardService();

  try {
    const result = await service.runWeeklyReset();
    if (result.skipped) {
      app.log.warn(
        { weekStartDate: result.weekStartDate },
        'Weekly leaderboard reset skipped because another instance is already running it.'
      );
      return;
    }

    app.log.info(
      {
        weekStartDate: result.weekStartDate,
        weekEndDate: result.weekEndDate,
        resetUsers: result.resetUsers
      },
      'Weekly leaderboard reset completed.'
    );
  } catch (error) {
    // Fail-safe: leaderboard job failure must never crash core API.
    app.log.error({ error }, 'Weekly leaderboard reset failed.');
  }
}
