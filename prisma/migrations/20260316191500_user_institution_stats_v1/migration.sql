CREATE TABLE "UserInstitutionStats" (
    "id" BIGSERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "institutionId" INTEGER NOT NULL,
    "weeklySp" INTEGER NOT NULL DEFAULT 0,
    "totalSp" INTEGER NOT NULL DEFAULT 0,
    "realExamsCompleted" INTEGER NOT NULL DEFAULT 0,
    "practiceExamsCompleted" INTEGER NOT NULL DEFAULT 0,
    "completedCollaborationExams" INTEGER NOT NULL DEFAULT 0,
    "lastExamAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserInstitutionStats_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "UserInstitutionStats"
    ADD CONSTRAINT "UserInstitutionStats_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "UserInstitutionStats"
    ADD CONSTRAINT "UserInstitutionStats_institutionId_fkey"
    FOREIGN KEY ("institutionId") REFERENCES "Institution"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE UNIQUE INDEX "UserInstitutionStats_userId_institutionId_key"
    ON "UserInstitutionStats"("userId", "institutionId");

CREATE INDEX "UserInstitutionStats_userId_idx"
    ON "UserInstitutionStats"("userId");

CREATE INDEX "UserInstitutionStats_institutionId_idx"
    ON "UserInstitutionStats"("institutionId");

CREATE INDEX "UserInstitutionStats_institutionId_weeklySp_totalSp_userId_idx"
    ON "UserInstitutionStats"("institutionId", "weeklySp", "totalSp", "userId");

CREATE INDEX "UserInstitutionStats_institutionId_totalSp_weeklySp_userId_idx"
    ON "UserInstitutionStats"("institutionId", "totalSp", "weeklySp", "userId");

CREATE INDEX "UserInstitutionStats_institutionId_realExamsCompleted_idx"
    ON "UserInstitutionStats"("institutionId", "realExamsCompleted");

CREATE INDEX "UserInstitutionStats_lastExamAt_idx"
    ON "UserInstitutionStats"("lastExamAt");

WITH aggregated_exam_stats AS (
    SELECT
        e."userId",
        e."institutionId",
        COALESCE(
            SUM(
                CASE
                    WHEN e."status" = 'COMPLETED'
                     AND timezone('Africa/Lagos', COALESCE(e."completedAt", e."startedAt")) >= date_trunc('week', timezone('Africa/Lagos', now()))
                    THEN e."spEarned"
                    ELSE 0
                END
            ),
            0
        )::integer AS "weeklySp",
        COALESCE(
            SUM(
                CASE
                    WHEN e."status" = 'COMPLETED' THEN e."spEarned"
                    ELSE 0
                END
            ),
            0
        )::integer AS "totalSp",
        COUNT(*) FILTER (
            WHERE e."status" = 'COMPLETED'
              AND e."examType" = 'REAL_PAST_QUESTION'
        )::integer AS "realExamsCompleted",
        COUNT(*) FILTER (
            WHERE e."status" = 'COMPLETED'
              AND e."examType" = 'PRACTICE'
        )::integer AS "practiceExamsCompleted",
        COUNT(*) FILTER (
            WHERE e."status" = 'COMPLETED'
              AND e."isCollaboration" = true
        )::integer AS "completedCollaborationExams",
        MAX(COALESCE(e."completedAt", e."startedAt")) AS "lastExamAt"
    FROM "Exam" e
    WHERE e."institutionId" IS NOT NULL
    GROUP BY e."userId", e."institutionId"
)
INSERT INTO "UserInstitutionStats" (
    "userId",
    "institutionId",
    "weeklySp",
    "totalSp",
    "realExamsCompleted",
    "practiceExamsCompleted",
    "completedCollaborationExams",
    "lastExamAt",
    "createdAt",
    "updatedAt"
)
SELECT
    stats."userId",
    stats."institutionId",
    stats."weeklySp",
    stats."totalSp",
    stats."realExamsCompleted",
    stats."practiceExamsCompleted",
    stats."completedCollaborationExams",
    stats."lastExamAt",
    NOW(),
    NOW()
FROM aggregated_exam_stats stats
ON CONFLICT ("userId", "institutionId") DO UPDATE
SET
    "weeklySp" = EXCLUDED."weeklySp",
    "totalSp" = EXCLUDED."totalSp",
    "realExamsCompleted" = EXCLUDED."realExamsCompleted",
    "practiceExamsCompleted" = EXCLUDED."practiceExamsCompleted",
    "completedCollaborationExams" = EXCLUDED."completedCollaborationExams",
    "lastExamAt" = EXCLUDED."lastExamAt",
    "updatedAt" = NOW();

WITH launch_institution AS (
    SELECT "id"
    FROM "Institution"
    WHERE "code" = 'UI'
    LIMIT 1
)
INSERT INTO "UserInstitutionStats" (
    "userId",
    "institutionId",
    "weeklySp",
    "totalSp",
    "realExamsCompleted",
    "practiceExamsCompleted",
    "completedCollaborationExams",
    "lastExamAt",
    "createdAt",
    "updatedAt"
)
SELECT
    u."id",
    COALESCE(u."targetInstitutionId", launch_institution."id"),
    u."weeklySp",
    u."totalSp",
    u."realExamsCompleted",
    0,
    u."completedCollaborationExams",
    NULL,
    NOW(),
    NOW()
FROM "User" u
CROSS JOIN launch_institution
LEFT JOIN "UserInstitutionStats" stats
    ON stats."userId" = u."id"
   AND stats."institutionId" = COALESCE(u."targetInstitutionId", launch_institution."id")
WHERE stats."id" IS NULL
  AND COALESCE(u."targetInstitutionId", launch_institution."id") IS NOT NULL
  AND (
      u."weeklySp" > 0
      OR u."totalSp" > 0
      OR u."realExamsCompleted" > 0
      OR u."completedCollaborationExams" > 0
  );
