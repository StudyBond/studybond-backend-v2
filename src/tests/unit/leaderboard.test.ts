import { describe, expect, it } from 'vitest';
import { compareLeaderboardRows } from '../../modules/leaderboard/leaderboard.ordering';
import { hasBoundaryTieAmbiguity } from '../../modules/leaderboard/leaderboard.projection';
import { leaderboardQuerySchema } from '../../modules/leaderboard/leaderboard.schema';
import { getLagosPreviousWeekBounds } from '../../modules/leaderboard/leaderboard.service';
import { evaluateLeaderboardIntegrityHeuristics } from '../../shared/leaderboard/integrity';

describe('leaderboard schema', () => {
  it('accepts an empty query', () => {
    const parsed = leaderboardQuerySchema.parse({});
    expect(parsed.limit).toBeUndefined();
    expect(parsed.institutionCode).toBeUndefined();
  });

  it('parses numeric limit from query string', () => {
    const parsed = leaderboardQuerySchema.parse({ limit: '25' });
    expect(parsed.limit).toBe(25);
  });

  it('normalizes institution code to uppercase', () => {
    const parsed = leaderboardQuerySchema.parse({ institutionCode: ' oau ' });
    expect(parsed.institutionCode).toBe('OAU');
  });

  it('rejects limits above 50', () => {
    const result = leaderboardQuerySchema.safeParse({ limit: '51' });
    expect(result.success).toBe(false);
  });
});

describe('getLagosPreviousWeekBounds', () => {
  it('returns previous monday-sunday range in Lagos calendar', () => {
    // Friday, March 6, 2026 (Lagos). Previous week should be 2026-02-23 to 2026-03-01.
    const reference = new Date('2026-03-06T12:00:00.000Z');
    const bounds = getLagosPreviousWeekBounds(reference);
    expect(bounds.weekStartDate).toBe('2026-02-23');
    expect(bounds.weekEndDate).toBe('2026-03-01');
  });
});

describe('leaderboard ordering', () => {
  it('sorts weekly leaderboard with deterministic tie-breaks', () => {
    const rows = [
      { id: 3, weeklySp: 100, totalSp: 200 },
      { id: 1, weeklySp: 100, totalSp: 200 },
      { id: 2, weeklySp: 100, totalSp: 250 },
      { id: 4, weeklySp: 90, totalSp: 999 }
    ];

    const sorted = [...rows].sort((left, right) => compareLeaderboardRows('WEEKLY', left, right));
    expect(sorted.map((row) => row.id)).toEqual([2, 1, 3, 4]);
  });

  it('sorts all-time leaderboard with deterministic tie-breaks', () => {
    const rows = [
      { id: 8, weeklySp: 80, totalSp: 500 },
      { id: 7, weeklySp: 90, totalSp: 500 },
      { id: 6, weeklySp: 90, totalSp: 500 },
      { id: 5, weeklySp: 10, totalSp: 300 }
    ];

    const sorted = [...rows].sort((left, right) => compareLeaderboardRows('ALL_TIME', left, right));
    expect(sorted.map((row) => row.id)).toEqual([6, 7, 8, 5]);
  });
});

describe('projection tie ambiguity', () => {
  it('detects ambiguity when global boundary ties exceed projected ties', () => {
    const ambiguous = hasBoundaryTieAmbiguity([120, 115, 110, 110], 110, 10);
    expect(ambiguous).toBe(true);
  });

  it('does not flag ambiguity when projected ties already cover boundary score', () => {
    const ambiguous = hasBoundaryTieAmbiguity([120, 115, 110, 110], 110, 2);
    expect(ambiguous).toBe(false);
  });
});

describe('leaderboard integrity heuristics', () => {
  it('flags impossible SP values', () => {
    const signals = evaluateLeaderboardIntegrityHeuristics({
      userId: 10,
      examId: 5,
      examType: 'REAL_PAST_QUESTION',
      totalQuestions: 100,
      spEarned: 200,
      percentage: 60,
      timeTakenSeconds: 1200,
      isCollaboration: false,
      isRetake: false
    }, 0);

    expect(signals.some((signal) => signal.signalType === 'IMPOSSIBLE_SP_VALUE')).toBe(true);
  });

  it('flags high score in unrealistically low time', () => {
    const signals = evaluateLeaderboardIntegrityHeuristics({
      userId: 11,
      examId: 6,
      examType: 'REAL_PAST_QUESTION',
      totalQuestions: 100,
      spEarned: 95,
      percentage: 95,
      timeTakenSeconds: 400,
      isCollaboration: false,
      isRetake: false
    }, 0);

    expect(signals.some((signal) => signal.signalType === 'HIGH_SCORE_LOW_TIME')).toBe(true);
  });
});
