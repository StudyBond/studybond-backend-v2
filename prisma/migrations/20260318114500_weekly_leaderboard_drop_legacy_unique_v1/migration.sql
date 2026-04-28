ALTER TABLE "WeeklyLeaderboard"
DROP CONSTRAINT IF EXISTS "WeeklyLeaderboard_userId_weekStartDate_key";

DROP INDEX IF EXISTS "WeeklyLeaderboard_userId_weekStartDate_key";
