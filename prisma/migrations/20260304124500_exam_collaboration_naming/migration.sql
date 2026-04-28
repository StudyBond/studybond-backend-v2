-- Exam and collaboration naming metadata + counters

-- 1) Add naming columns
ALTER TABLE "Exam"
  ADD COLUMN "nameScopeKey" TEXT,
  ADD COLUMN "sessionNumber" INTEGER;

ALTER TABLE "CollaborationSession"
  ADD COLUMN "nameScopeKey" TEXT,
  ADD COLUMN "sessionNumber" INTEGER,
  ADD COLUMN "customName" TEXT;

-- 2) Counter tables
CREATE TABLE "ExamSessionCounter" (
  "id" SERIAL NOT NULL,
  "userId" INTEGER NOT NULL,
  "scopeKey" TEXT NOT NULL,
  "currentValue" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ExamSessionCounter_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CollaborationSessionCounter" (
  "id" SERIAL NOT NULL,
  "userId" INTEGER NOT NULL,
  "scopeKey" TEXT NOT NULL,
  "currentValue" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CollaborationSessionCounter_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "ExamSessionCounter"
  ADD CONSTRAINT "ExamSessionCounter_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CollaborationSessionCounter"
  ADD CONSTRAINT "CollaborationSessionCounter_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE UNIQUE INDEX "ExamSessionCounter_userId_scopeKey_key"
  ON "ExamSessionCounter"("userId", "scopeKey");
CREATE INDEX "ExamSessionCounter_userId_idx"
  ON "ExamSessionCounter"("userId");

CREATE UNIQUE INDEX "CollaborationSessionCounter_userId_scopeKey_key"
  ON "CollaborationSessionCounter"("userId", "scopeKey");
CREATE INDEX "CollaborationSessionCounter_userId_idx"
  ON "CollaborationSessionCounter"("userId");

-- 3) Backfill Exam.nameScopeKey
UPDATE "Exam" e
SET "nameScopeKey" = CASE
  WHEN e."examType" = 'REAL_PAST_QUESTION' THEN
    CASE
      WHEN cardinality(e."subjectsIncluded") = 4 AND 'English' = ANY(e."subjectsIncluded")
        THEN 'REAL:FULL'
      ELSE 'REAL:' || COALESCE(
        (
          SELECT string_agg(
            CASE subject
              WHEN 'Biology' THEN 'BIO'
              WHEN 'Chemistry' THEN 'CHM'
              WHEN 'Physics' THEN 'PHY'
              WHEN 'Mathematics' THEN 'MTH'
              WHEN 'English' THEN 'ENG'
              ELSE subject
            END,
            '|'
            ORDER BY CASE subject
              WHEN 'Biology' THEN 1
              WHEN 'Chemistry' THEN 2
              WHEN 'Physics' THEN 3
              WHEN 'Mathematics' THEN 4
              WHEN 'English' THEN 5
              ELSE 99
            END
          )
          FROM unnest(e."subjectsIncluded") AS subject
        ),
        'UNKNOWN'
      )
    END
  WHEN e."examType" = 'PRACTICE' THEN
    CASE
      WHEN cardinality(e."subjectsIncluded") = 4 AND 'English' = ANY(e."subjectsIncluded")
        THEN 'PRACTICE:FULL'
      ELSE 'PRACTICE:' || COALESCE(
        (
          SELECT string_agg(
            CASE subject
              WHEN 'Biology' THEN 'BIO'
              WHEN 'Chemistry' THEN 'CHM'
              WHEN 'Physics' THEN 'PHY'
              WHEN 'Mathematics' THEN 'MTH'
              WHEN 'English' THEN 'ENG'
              ELSE subject
            END,
            '|'
            ORDER BY CASE subject
              WHEN 'Biology' THEN 1
              WHEN 'Chemistry' THEN 2
              WHEN 'Physics' THEN 3
              WHEN 'Mathematics' THEN 4
              WHEN 'English' THEN 5
              ELSE 99
            END
          )
          FROM unnest(e."subjectsIncluded") AS subject
        ),
        'UNKNOWN'
      )
    END
  WHEN e."examType" = 'ONE_V_ONE_DUEL' THEN
    'DUEL:' || COALESCE(
      (
        SELECT string_agg(
          CASE subject
            WHEN 'Biology' THEN 'BIO'
            WHEN 'Chemistry' THEN 'CHM'
            WHEN 'Physics' THEN 'PHY'
            WHEN 'Mathematics' THEN 'MTH'
            WHEN 'English' THEN 'ENG'
            ELSE subject
          END,
          '|'
          ORDER BY CASE subject
            WHEN 'Biology' THEN 1
            WHEN 'Chemistry' THEN 2
            WHEN 'Physics' THEN 3
            WHEN 'Mathematics' THEN 4
            WHEN 'English' THEN 5
            ELSE 99
          END
        )
        FROM unnest(e."subjectsIncluded") AS subject
      ),
      'UNKNOWN'
    )
  ELSE
    'GROUP:' || COALESCE(
      (
        SELECT string_agg(
          CASE subject
            WHEN 'Biology' THEN 'BIO'
            WHEN 'Chemistry' THEN 'CHM'
            WHEN 'Physics' THEN 'PHY'
            WHEN 'Mathematics' THEN 'MTH'
            WHEN 'English' THEN 'ENG'
            ELSE subject
          END,
          '|'
          ORDER BY CASE subject
            WHEN 'Biology' THEN 1
            WHEN 'Chemistry' THEN 2
            WHEN 'Physics' THEN 3
            WHEN 'Mathematics' THEN 4
            WHEN 'English' THEN 5
            ELSE 99
          END
        )
        FROM unnest(e."subjectsIncluded") AS subject
      ),
      'UNKNOWN'
    )
END;

-- 4) Backfill Exam.sessionNumber with stable ordering
WITH ranked AS (
  SELECT
    "id",
    ROW_NUMBER() OVER (
      PARTITION BY "userId", "nameScopeKey"
      ORDER BY "startedAt" ASC, "id" ASC
    ) AS rn
  FROM "Exam"
)
UPDATE "Exam" e
SET "sessionNumber" = ranked.rn
FROM ranked
WHERE e."id" = ranked."id";

-- 5) Backfill CollaborationSession naming columns
UPDATE "CollaborationSession" s
SET "nameScopeKey" = CASE
  WHEN s."sessionType" = 'ONE_V_ONE_DUEL' THEN
    CASE
      WHEN cardinality(s."subjectsIncluded") = 4 AND 'English' = ANY(s."subjectsIncluded")
        THEN 'DUEL:FULL'
      ELSE 'DUEL:' || COALESCE(
        (
          SELECT string_agg(
            CASE subject
              WHEN 'Biology' THEN 'BIO'
              WHEN 'Chemistry' THEN 'CHM'
              WHEN 'Physics' THEN 'PHY'
              WHEN 'Mathematics' THEN 'MTH'
              WHEN 'English' THEN 'ENG'
              ELSE subject
            END,
            '|'
            ORDER BY CASE subject
              WHEN 'Biology' THEN 1
              WHEN 'Chemistry' THEN 2
              WHEN 'Physics' THEN 3
              WHEN 'Mathematics' THEN 4
              WHEN 'English' THEN 5
              ELSE 99
            END
          )
          FROM unnest(s."subjectsIncluded") AS subject
        ),
        'UNKNOWN'
      )
    END
  ELSE
    'GROUP:' || COALESCE(
      (
        SELECT string_agg(
          CASE subject
            WHEN 'Biology' THEN 'BIO'
            WHEN 'Chemistry' THEN 'CHM'
            WHEN 'Physics' THEN 'PHY'
            WHEN 'Mathematics' THEN 'MTH'
            WHEN 'English' THEN 'ENG'
            ELSE subject
          END,
          '|'
          ORDER BY CASE subject
            WHEN 'Biology' THEN 1
            WHEN 'Chemistry' THEN 2
            WHEN 'Physics' THEN 3
            WHEN 'Mathematics' THEN 4
            WHEN 'English' THEN 5
            ELSE 99
          END
        )
        FROM unnest(s."subjectsIncluded") AS subject
      ),
      'UNKNOWN'
    )
END;

WITH ranked_collab AS (
  SELECT
    "id",
    ROW_NUMBER() OVER (
      PARTITION BY "hostUserId", "nameScopeKey"
      ORDER BY "createdAt" ASC, "id" ASC
    ) AS rn
  FROM "CollaborationSession"
)
UPDATE "CollaborationSession" s
SET "sessionNumber" = ranked_collab.rn
FROM ranked_collab
WHERE s."id" = ranked_collab."id";

-- 6) Build counters from backfilled maxima
INSERT INTO "ExamSessionCounter" ("userId", "scopeKey", "currentValue")
SELECT
  e."userId",
  e."nameScopeKey",
  MAX(e."sessionNumber")
FROM "Exam" e
GROUP BY e."userId", e."nameScopeKey"
ON CONFLICT ("userId", "scopeKey")
DO UPDATE SET
  "currentValue" = EXCLUDED."currentValue",
  "updatedAt" = CURRENT_TIMESTAMP;

INSERT INTO "CollaborationSessionCounter" ("userId", "scopeKey", "currentValue")
SELECT
  s."hostUserId" AS "userId",
  s."nameScopeKey",
  MAX(s."sessionNumber")
FROM "CollaborationSession" s
GROUP BY s."hostUserId", s."nameScopeKey"
ON CONFLICT ("userId", "scopeKey")
DO UPDATE SET
  "currentValue" = EXCLUDED."currentValue",
  "updatedAt" = CURRENT_TIMESTAMP;

-- 7) Enforce non-null and add indexes/constraints
ALTER TABLE "Exam"
  ALTER COLUMN "nameScopeKey" SET NOT NULL,
  ALTER COLUMN "sessionNumber" SET NOT NULL;

ALTER TABLE "CollaborationSession"
  ALTER COLUMN "nameScopeKey" SET NOT NULL,
  ALTER COLUMN "sessionNumber" SET NOT NULL;

CREATE INDEX "Exam_userId_nameScopeKey_idx"
  ON "Exam"("userId", "nameScopeKey");
CREATE UNIQUE INDEX "Exam_userId_nameScopeKey_sessionNumber_key"
  ON "Exam"("userId", "nameScopeKey", "sessionNumber");

CREATE INDEX "CollaborationSession_hostUserId_nameScopeKey_idx"
  ON "CollaborationSession"("hostUserId", "nameScopeKey");
CREATE UNIQUE INDEX "CollaborationSession_hostUserId_nameScopeKey_sessionNumber_key"
  ON "CollaborationSession"("hostUserId", "nameScopeKey", "sessionNumber");
