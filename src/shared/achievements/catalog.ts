import { AchievementKey } from '@prisma/client';

export interface AchievementDefinition {
  key: AchievementKey;
  title: string;
  description: string;
  category: 'STREAK' | 'COLLABORATION';
  progressTarget: number;
}

export const ACHIEVEMENT_CATALOG: Record<AchievementKey, AchievementDefinition> = {
  STREAK_7_DAY_STARTER: {
    key: 'STREAK_7_DAY_STARTER',
    title: '7-Day Streak Starter',
    description: 'Build your first 7-day streak and earn a streak freezer.',
    category: 'STREAK',
    progressTarget: 7
  },
  COLLABORATION_30_COMPLETIONS: {
    key: 'COLLABORATION_30_COMPLETIONS',
    title: 'Collaboration Finisher',
    description: 'Complete 30 collaboration exams without abandoning them.',
    category: 'COLLABORATION',
    progressTarget: 30
  }
};

export const ACHIEVEMENT_ORDER: AchievementKey[] = [
  'STREAK_7_DAY_STARTER',
  'COLLABORATION_30_COMPLETIONS'
];
