ALTER TYPE "AdminAuditAction" ADD VALUE IF NOT EXISTS 'REPORT_REVIEWED';
ALTER TYPE "AdminAuditAction" ADD VALUE IF NOT EXISTS 'REPORT_HARD_DELETED';

ALTER TABLE "QuestionReport"
  ADD COLUMN "adminNote" TEXT,
  ADD COLUMN "reviewedAt" TIMESTAMP(3),
  ADD COLUMN "reviewedByAdminId" INTEGER,
  ADD COLUMN "resolvedAt" TIMESTAMP(3),
  ADD COLUMN "resolvedByAdminId" INTEGER;

WITH ranked_reports AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY "userId", "questionId", "issueType"
      ORDER BY id ASC
    ) AS row_number
  FROM "QuestionReport"
)
DELETE FROM "QuestionReport" target
USING ranked_reports ranked
WHERE target.id = ranked.id
  AND ranked.row_number > 1;

ALTER TABLE "QuestionReport" DROP CONSTRAINT IF EXISTS "QuestionReport_userId_fkey";
ALTER TABLE "QuestionReport" DROP CONSTRAINT IF EXISTS "QuestionReport_questionId_fkey";

ALTER TABLE "QuestionReport"
  ADD CONSTRAINT "QuestionReport_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "QuestionReport_questionId_fkey"
    FOREIGN KEY ("questionId") REFERENCES "Question"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "QuestionReport_reviewedByAdminId_fkey"
    FOREIGN KEY ("reviewedByAdminId") REFERENCES "User"("id")
    ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "QuestionReport_resolvedByAdminId_fkey"
    FOREIGN KEY ("resolvedByAdminId") REFERENCES "User"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

CREATE UNIQUE INDEX IF NOT EXISTS "QuestionReport_userId_questionId_issueType_key"
  ON "QuestionReport"("userId", "questionId", "issueType");

CREATE INDEX IF NOT EXISTS "QuestionReport_userId_createdAt_idx"
  ON "QuestionReport"("userId", "createdAt");

CREATE INDEX IF NOT EXISTS "QuestionReport_questionId_status_createdAt_idx"
  ON "QuestionReport"("questionId", "status", "createdAt");

CREATE INDEX IF NOT EXISTS "QuestionReport_reviewedByAdminId_reviewedAt_idx"
  ON "QuestionReport"("reviewedByAdminId", "reviewedAt");

CREATE INDEX IF NOT EXISTS "QuestionReport_resolvedByAdminId_resolvedAt_idx"
  ON "QuestionReport"("resolvedByAdminId", "resolvedAt");
