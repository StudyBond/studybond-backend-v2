-- Add collaboration completion counter and persisted achievement records.
CREATE TYPE "AchievementKey" AS ENUM (
  'STREAK_7_DAY_STARTER',
  'COLLABORATION_30_COMPLETIONS'
);

ALTER TABLE "User"
ADD COLUMN "completedCollaborationExams" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE "UserAchievement" (
  "id" BIGSERIAL NOT NULL,
  "userId" INTEGER NOT NULL,
  "key" "AchievementKey" NOT NULL,
  "unlockedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "metadata" JSONB,

  CONSTRAINT "UserAchievement_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "UserAchievement_userId_key_key" ON "UserAchievement"("userId", "key");
CREATE INDEX "UserAchievement_userId_unlockedAt_idx" ON "UserAchievement"("userId", "unlockedAt");

ALTER TABLE "UserAchievement"
ADD CONSTRAINT "UserAchievement_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
