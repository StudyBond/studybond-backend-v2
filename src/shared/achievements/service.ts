import { AchievementKey, Prisma } from "@prisma/client";
import {
  ACHIEVEMENT_CATALOG,
  ACHIEVEMENT_ORDER,
  AchievementDefinition,
} from "./catalog";

export interface UserAchievementView {
  key: AchievementKey;
  title: string;
  description: string;
  category: AchievementDefinition["category"];
  unlocked: boolean;
  unlockedAt: string | null;
  progress: {
    current: number;
    target: number;
    percentage: number;
  };
}

export async function awardAchievementIfMissingTx(
  tx: Prisma.TransactionClient,
  userId: number,
  key: AchievementKey,
  metadata?: Prisma.InputJsonValue,
): Promise<void> {
  await tx.userAchievement.upsert({
    where: {
      userId_key: {
        userId,
        key,
      },
    },
    update: {},
    create: {
      userId,
      key,
      metadata,
    },
  });
}

export function buildAchievementViews(
  unlockedRows: Array<{ key: AchievementKey; unlockedAt: Date }>,
  progress: Record<AchievementKey, number>,
): UserAchievementView[] {
  const unlockedByKey = new Map<AchievementKey, Date>(
    unlockedRows.map((row) => [row.key, row.unlockedAt]),
  );

  return ACHIEVEMENT_ORDER.map((key) => {
    const definition = ACHIEVEMENT_CATALOG[key];
    const current = Math.max(
      0,
      Math.min(progress[key] ?? 0, definition.progressTarget),
    );
    const unlockedAt = unlockedByKey.get(key) ?? null;

    return {
      key,
      title: definition.title,
      description: definition.description,
      category: definition.category,
      unlocked: Boolean(unlockedAt),
      unlockedAt: unlockedAt ? unlockedAt.toISOString() : null,
      progress: {
        current,
        target: definition.progressTarget,
        percentage: Math.min(
          100,
          Math.round((current / definition.progressTarget) * 100),
        ),
      },
    };
  });
}
