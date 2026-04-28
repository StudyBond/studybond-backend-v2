-- StudyBond hardening v4:
-- - idempotency ledger
-- - session token replay guard
-- - exam invariants for in-progress uniqueness and retake monotonicity

DO $$
BEGIN
  CREATE TYPE "IdempotencyState" AS ENUM ('IN_PROGRESS', 'COMPLETED', 'FAILED_RETRYABLE', 'FAILED_FINAL');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "UserSession"
  ADD COLUMN IF NOT EXISTS "tokenVersion" INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS "UserSession_isActive_expiresAt_idx"
  ON "UserSession"("isActive", "expiresAt");

CREATE INDEX IF NOT EXISTS "UserSession_userId_isActive_expiresAt_idx"
  ON "UserSession"("userId", "isActive", "expiresAt");

CREATE TABLE IF NOT EXISTS "IdempotencyRecord" (
  "id" BIGSERIAL NOT NULL,
  "userId" INTEGER NOT NULL,
  "routeKey" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "requestHash" TEXT NOT NULL,
  "state" "IdempotencyState" NOT NULL DEFAULT 'IN_PROGRESS',
  "statusCode" INTEGER,
  "responseBody" JSONB,
  "errorCode" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "IdempotencyRecord_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "IdempotencyRecord"
  ADD CONSTRAINT "IdempotencyRecord_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE UNIQUE INDEX IF NOT EXISTS "IdempotencyRecord_userId_routeKey_idempotencyKey_key"
  ON "IdempotencyRecord"("userId", "routeKey", "idempotencyKey");

CREATE INDEX IF NOT EXISTS "IdempotencyRecord_expiresAt_idx"
  ON "IdempotencyRecord"("expiresAt");

CREATE INDEX IF NOT EXISTS "IdempotencyRecord_expiresAt_userId_idx"
  ON "IdempotencyRecord"("expiresAt", "userId");

CREATE INDEX IF NOT EXISTS "IdempotencyRecord_state_idx"
  ON "IdempotencyRecord"("state");

-- Keep only the most recent in-progress exam per user+scope before enforcing uniqueness.
WITH ranked AS (
  SELECT
    "id",
    ROW_NUMBER() OVER (
      PARTITION BY "userId", "nameScopeKey"
      ORDER BY "startedAt" DESC, "id" DESC
    ) AS rn
  FROM "Exam"
  WHERE "status" = 'IN_PROGRESS'::"ExamStatus"
)
UPDATE "Exam" e
SET
  "status" = 'ABANDONED'::"ExamStatus",
  "completedAt" = COALESCE(e."completedAt", NOW())
FROM ranked r
WHERE e."id" = r."id" AND r.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS "Exam_userId_nameScopeKey_in_progress_key"
  ON "Exam"("userId", "nameScopeKey")
  WHERE "status" = 'IN_PROGRESS'::"ExamStatus";

CREATE UNIQUE INDEX IF NOT EXISTS "Exam_userId_originalExamId_attemptNumber_key"
  ON "Exam"("userId", "originalExamId", "attemptNumber")
  WHERE "originalExamId" IS NOT NULL;
