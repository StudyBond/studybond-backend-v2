import { describe, expect, it } from 'vitest';
import {
  calculateNextStreakValues,
  deriveStreakSnapshot,
  getLagosDayStart,
  getNextMilestone
} from '../../shared/streaks/domain';

describe('streak domain', () => {
  it('marks a streak as active when the user studied today', () => {
    const now = new Date('2026-03-12T10:00:00.000Z');
    const snapshot = deriveStreakSnapshot(6, 9, getLagosDayStart(now), now);

    expect(snapshot).toEqual(expect.objectContaining({
      currentStreak: 6,
      status: 'ACTIVE',
      studiedToday: true,
      canStillSaveToday: false,
      streakFreezesAvailable: 0,
      freezerProtectionActive: false
    }));
  });

  it('marks a streak as at risk when the user last studied yesterday', () => {
    const now = new Date('2026-03-12T10:00:00.000Z');
    const yesterday = new Date('2026-03-11T00:00:00.000Z');
    const snapshot = deriveStreakSnapshot(6, 9, yesterday, now);

    expect(snapshot).toEqual(expect.objectContaining({
      currentStreak: 6,
      status: 'AT_RISK',
      studiedToday: false,
      studiedYesterday: true,
      canStillSaveToday: true,
      freezerProtectionActive: false
    }));
  });

  it('keeps a streak alive for one extra day when a freezer is available', () => {
    const now = new Date('2026-03-12T10:00:00.000Z');
    const twoDaysAgo = new Date('2026-03-10T00:00:00.000Z');
    const snapshot = deriveStreakSnapshot(6, 9, twoDaysAgo, now, 1);

    expect(snapshot).toEqual(expect.objectContaining({
      currentStreak: 6,
      status: 'AT_RISK',
      studiedToday: false,
      studiedYesterday: false,
      canStillSaveToday: true,
      streakFreezesAvailable: 1,
      freezerProtectionActive: true
    }));
  });

  it('marks a streak as broken when the last activity is older than the freezer window', () => {
    const now = new Date('2026-03-12T10:00:00.000Z');
    const oldDay = new Date('2026-03-09T00:00:00.000Z');
    const snapshot = deriveStreakSnapshot(6, 9, oldDay, now, 1);

    expect(snapshot).toEqual(expect.objectContaining({
      currentStreak: 0,
      status: 'BROKEN',
      studiedToday: false,
      canStillSaveToday: false,
      freezerProtectionActive: false
    }));
  });

  it('increments the streak on a consecutive study day, unlocks the 7-day reward, and credits a freezer', () => {
    const now = new Date('2026-03-12T10:00:00.000Z');
    const yesterday = new Date('2026-03-11T00:00:00.000Z');

    const update = calculateNextStreakValues(6, 6, yesterday, 0, now);

    expect(update.currentStreak).toBe(7);
    expect(update.longestStreak).toBe(7);
    expect(update.milestonesUnlocked).toEqual([7]);
    expect(update.streakFreezesAvailable).toBe(1);
  });

  it('renews a freezer every 14 streak days after day 7 when the user has none', () => {
    const now = new Date('2026-03-26T10:00:00.000Z');
    const yesterday = new Date('2026-03-25T00:00:00.000Z');

    const update = calculateNextStreakValues(20, 20, yesterday, 0, now);

    expect(update.currentStreak).toBe(21);
    expect(update.longestStreak).toBe(21);
    expect(update.streakFreezesAvailable).toBe(1);
  });

  it('does not stack another freezer at the 14-day renewal checkpoint if one is already available', () => {
    const now = new Date('2026-03-26T10:00:00.000Z');
    const yesterday = new Date('2026-03-25T00:00:00.000Z');

    const update = calculateNextStreakValues(20, 20, yesterday, 1, now);

    expect(update.currentStreak).toBe(21);
    expect(update.longestStreak).toBe(21);
    expect(update.streakFreezesAvailable).toBe(1);
  });

  it('consumes a freezer when a user returns after one missed day inside the freeze window', () => {
    const now = new Date('2026-03-12T10:00:00.000Z');
    const twoDaysAgo = new Date('2026-03-10T00:00:00.000Z');

    const update = calculateNextStreakValues(8, 10, twoDaysAgo, 1, now);

    expect(update.currentStreak).toBe(9);
    expect(update.longestStreak).toBe(10);
    expect(update.streakFreezesAvailable).toBe(0);
  });

  it('returns the next milestone based on the effective current streak', () => {
    expect(getNextMilestone(4)).toEqual(expect.objectContaining({
      days: 7,
      remainingDays: 3
    }));
    expect(getNextMilestone(12)).toEqual(expect.objectContaining({
      days: 30,
      remainingDays: 18
    }));
  });
});
