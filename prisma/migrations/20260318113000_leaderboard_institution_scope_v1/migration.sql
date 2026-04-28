ALTER TABLE "WeeklyLeaderboard"
DROP CONSTRAINT IF EXISTS "WeeklyLeaderboard_userId_weekStartDate_key";

ALTER TABLE "WeeklyLeaderboard"
ADD CONSTRAINT "WeeklyLeaderboard_userId_institutionId_weekStartDate_key"
UNIQUE ("userId", "institutionId", "weekStartDate");

CREATE INDEX IF NOT EXISTS "WeeklyLeaderboard_institutionId_weekStartDate_weeklySp_idx"
ON "WeeklyLeaderboard" ("institutionId", "weekStartDate", "weeklySp");
