-- Improve streak reminder and reconciliation scans.
CREATE INDEX IF NOT EXISTS "User_currentStreak_lastActivityDate_idx"
ON "User"("currentStreak", "lastActivityDate");

CREATE INDEX IF NOT EXISTS "User_lastStreakReminder_idx"
ON "User"("lastStreakReminder");
