ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'LEADERBOARD_SIGNAL_FLAGGED';

CREATE TABLE IF NOT EXISTS "LeaderboardProjectionEvent" (
  "id" BIGSERIAL NOT NULL,
  "userId" INTEGER NOT NULL,
  "weeklySp" INTEGER NOT NULL,
  "totalSp" INTEGER NOT NULL,
  "source" TEXT NOT NULL,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "errorMessage" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "processedAt" TIMESTAMP(3),
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LeaderboardProjectionEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "LeaderboardIntegritySignal" (
  "id" BIGSERIAL NOT NULL,
  "userId" INTEGER NOT NULL,
  "signalType" TEXT NOT NULL,
  "severity" TEXT NOT NULL,
  "context" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LeaderboardIntegritySignal_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "LeaderboardProjectionEvent"
  ADD CONSTRAINT "LeaderboardProjectionEvent_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "LeaderboardIntegritySignal"
  ADD CONSTRAINT "LeaderboardIntegritySignal_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX IF NOT EXISTS "LeaderboardProjectionEvent_processedAt_attempts_createdAt_idx"
ON "LeaderboardProjectionEvent"("processedAt", "attempts", "createdAt");

CREATE INDEX IF NOT EXISTS "LeaderboardProjectionEvent_userId_createdAt_idx"
ON "LeaderboardProjectionEvent"("userId", "createdAt");

CREATE INDEX IF NOT EXISTS "LeaderboardIntegritySignal_userId_signalType_createdAt_idx"
ON "LeaderboardIntegritySignal"("userId", "signalType", "createdAt");

CREATE INDEX IF NOT EXISTS "LeaderboardIntegritySignal_createdAt_idx"
ON "LeaderboardIntegritySignal"("createdAt");
