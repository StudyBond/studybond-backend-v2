import prisma from '../../config/database';
import { getCacheAdapter } from '../cache/cache';
import { getGlobalMetricsRegistry } from '../metrics/global';

export type LeaderboardSignalType =
  | 'IMPOSSIBLE_SP_VALUE'
  | 'HIGH_SP_VELOCITY_5M'
  | 'HIGH_SCORE_LOW_TIME';

export type LeaderboardSignalSeverity = 'LOW' | 'MEDIUM' | 'HIGH';

export interface LeaderboardIntegrityInput {
  userId: number;
  examId: number;
  examType: string;
  totalQuestions: number;
  spEarned: number;
  percentage: number;
  timeTakenSeconds: number;
  isCollaboration: boolean;
  isRetake: boolean;
}

interface SignalCandidate {
  signalType: LeaderboardSignalType;
  severity: LeaderboardSignalSeverity;
  context: Record<string, unknown>;
}

function parseIntOrDefault(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value || '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const HIGH_SCORE_PERCENT_THRESHOLD = parseIntOrDefault(
  process.env.LEADERBOARD_SIGNAL_HIGH_SCORE_PERCENT,
  90
);
const LOW_TIME_SECONDS_PER_QUESTION = parseIntOrDefault(
  process.env.LEADERBOARD_SIGNAL_LOW_TIME_SECONDS_PER_QUESTION,
  8
);
const VELOCITY_LIMIT_PER_5M = parseIntOrDefault(
  process.env.LEADERBOARD_SIGNAL_SP_VELOCITY_LIMIT_5M,
  25
);

function getMaxExpectedSp(totalQuestions: number): number {
  return Math.ceil(totalQuestions * 1.5);
}

export function evaluateLeaderboardIntegrityHeuristics(
  input: LeaderboardIntegrityInput,
  velocityCountInWindow: number
): Array<{ signalType: LeaderboardSignalType; severity: LeaderboardSignalSeverity }> {
  const detected: Array<{ signalType: LeaderboardSignalType; severity: LeaderboardSignalSeverity }> = [];
  const maxExpectedSp = getMaxExpectedSp(input.totalQuestions);

  if (input.spEarned < 0 || input.spEarned > maxExpectedSp) {
    detected.push({ signalType: 'IMPOSSIBLE_SP_VALUE', severity: 'HIGH' });
  }

  if (
    input.totalQuestions > 0 &&
    input.percentage >= HIGH_SCORE_PERCENT_THRESHOLD &&
    input.timeTakenSeconds > 0 &&
    input.timeTakenSeconds <= (input.totalQuestions * LOW_TIME_SECONDS_PER_QUESTION)
  ) {
    detected.push({ signalType: 'HIGH_SCORE_LOW_TIME', severity: 'MEDIUM' });
  }

  if (velocityCountInWindow > VELOCITY_LIMIT_PER_5M) {
    detected.push({ signalType: 'HIGH_SP_VELOCITY_5M', severity: 'MEDIUM' });
  }

  return detected;
}

async function checkVelocity(userId: number): Promise<{ flagged: boolean; count: number }> {
  const cache = getCacheAdapter();
  if (!cache.available) {
    return { flagged: false, count: 0 };
  }

  const velocityKey = `lb:signal:sp-velocity:${userId}`;
  try {
    const count = await cache.incr(velocityKey);
    if (count === 1) {
      await cache.expire(velocityKey, 5 * 60);
    }
    return { flagged: count > VELOCITY_LIMIT_PER_5M, count };
  } catch {
    return { flagged: false, count: 0 };
  }
}

async function persistSignal(
  userId: number,
  signal: SignalCandidate
): Promise<void> {
  await prisma.$transaction(async (tx: any) => {
    await tx.leaderboardIntegritySignal.create({
      data: {
        userId,
        signalType: signal.signalType,
        severity: signal.severity,
        context: signal.context
      }
    });

    await tx.auditLog.create({
      data: {
        userId,
        action: 'LEADERBOARD_SIGNAL_FLAGGED',
        metadata: {
          signalType: signal.signalType,
          severity: signal.severity,
          context: signal.context
        }
      }
    });
  });

  const metrics = getGlobalMetricsRegistry();
  metrics?.incrementCounter('leaderboard_integrity_signals_total', 1, {
    type: signal.signalType,
    severity: signal.severity
  });
}

export async function runLeaderboardIntegrityChecks(input: LeaderboardIntegrityInput): Promise<void> {
  const velocity = await checkVelocity(input.userId);
  const detected = evaluateLeaderboardIntegrityHeuristics(input, velocity.count);
  const maxExpectedSp = getMaxExpectedSp(input.totalQuestions);

  const candidates: SignalCandidate[] = detected.map((signal) => {
    if (signal.signalType === 'IMPOSSIBLE_SP_VALUE') {
      return {
        signalType: signal.signalType,
        severity: signal.severity,
        context: {
          examId: input.examId,
          examType: input.examType,
          spEarned: input.spEarned,
          maxExpectedSp,
          totalQuestions: input.totalQuestions,
          isCollaboration: input.isCollaboration,
          isRetake: input.isRetake
        }
      };
    }

    if (signal.signalType === 'HIGH_SCORE_LOW_TIME') {
      return {
        signalType: signal.signalType,
        severity: signal.severity,
        context: {
          examId: input.examId,
          examType: input.examType,
          percentage: input.percentage,
          timeTakenSeconds: input.timeTakenSeconds,
          totalQuestions: input.totalQuestions,
          thresholdSeconds: input.totalQuestions * LOW_TIME_SECONDS_PER_QUESTION
        }
      };
    }

    return {
      signalType: signal.signalType,
      severity: signal.severity,
      context: {
        examId: input.examId,
        examType: input.examType,
        countInWindow: velocity.count,
        windowSeconds: 300,
        limit: VELOCITY_LIMIT_PER_5M,
        flagged: velocity.flagged
      }
    };
  });

  for (const signal of candidates) {
    try {
      await persistSignal(input.userId, signal);
    } catch {
      // Integrity signal logging must never break submission flow.
    }
  }
}
