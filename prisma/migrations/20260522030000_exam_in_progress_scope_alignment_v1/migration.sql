-- Align in-progress exam uniqueness with institution-scoped exam starts.
-- Also remove any legacy two-column user+scope uniqueness that blocks new
-- Daily Challenge sessions after a previous day's attempt.

ALTER TABLE "Exam" DROP CONSTRAINT IF EXISTS "Exam_userId_nameScopeKey_key";
DROP INDEX IF EXISTS "Exam_userId_nameScopeKey_key";
DROP INDEX IF EXISTS "Exam_userId_nameScopeKey_in_progress_key";

WITH ranked AS (
  SELECT
    "id",
    ROW_NUMBER() OVER (
      PARTITION BY "userId", COALESCE("institutionId", 0), "nameScopeKey"
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

CREATE UNIQUE INDEX IF NOT EXISTS "Exam_userId_institutionId_nameScopeKey_in_progress_key"
  ON "Exam"("userId", COALESCE("institutionId", 0), "nameScopeKey")
  WHERE "status" = 'IN_PROGRESS'::"ExamStatus";
