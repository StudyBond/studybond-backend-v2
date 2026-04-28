import { LeaderboardType } from './leaderboard.types';

export interface LeaderboardComparableRow {
  id: number;
  weeklySp: number;
  totalSp: number;
}

export function compareLeaderboardRows(
  type: LeaderboardType,
  left: LeaderboardComparableRow,
  right: LeaderboardComparableRow
): number {
  if (type === 'WEEKLY') {
    return (
      (right.weeklySp - left.weeklySp) ||
      (right.totalSp - left.totalSp) ||
      (left.id - right.id)
    );
  }

  return (
    (right.totalSp - left.totalSp) ||
    (right.weeklySp - left.weeklySp) ||
    (left.id - right.id)
  );
}
