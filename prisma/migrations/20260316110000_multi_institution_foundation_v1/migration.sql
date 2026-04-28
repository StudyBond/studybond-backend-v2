CREATE TYPE "InstitutionQuestionSourceMode" AS ENUM ('REAL_PAST_QUESTION', 'PRACTICE', 'MIXED');

CREATE TABLE "Institution" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Institution_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "InstitutionExamConfig" (
    "id" SERIAL NOT NULL,
    "institutionId" INTEGER NOT NULL,
    "trackCode" TEXT NOT NULL DEFAULT 'POST_UTME',
    "trackName" TEXT NOT NULL DEFAULT 'Post-UTME',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "questionsPerSubject" INTEGER NOT NULL,
    "fullExamQuestions" INTEGER NOT NULL,
    "maxSubjects" INTEGER NOT NULL,
    "singleSubjectDurationSeconds" INTEGER NOT NULL,
    "twoSubjectDurationSeconds" INTEGER NOT NULL,
    "threeSubjectDurationSeconds" INTEGER NOT NULL,
    "fullExamDurationSeconds" INTEGER NOT NULL,
    "collaborationDurationSeconds" INTEGER NOT NULL,
    "freeRealExamCount" INTEGER NOT NULL,
    "freeFullRealTotalAttempts" INTEGER NOT NULL,
    "premiumDailyRealExamLimit" INTEGER NOT NULL,
    "collaborationGateRealExams" INTEGER NOT NULL,
    "defaultFullExamSource" "InstitutionQuestionSourceMode" NOT NULL,
    "defaultPartialExamSource" "InstitutionQuestionSourceMode" NOT NULL,
    "defaultCollabSource" "InstitutionQuestionSourceMode" NOT NULL,
    "allowMixedPartialExams" BOOLEAN NOT NULL DEFAULT true,
    "allowMixedFullExams" BOOLEAN NOT NULL DEFAULT false,
    "allowPracticeCollaboration" BOOLEAN NOT NULL DEFAULT true,
    "allowMixedCollaboration" BOOLEAN NOT NULL DEFAULT true,
    "additionalRules" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InstitutionExamConfig_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Institution_code_key" ON "Institution"("code");
CREATE UNIQUE INDEX "Institution_slug_key" ON "Institution"("slug");
CREATE UNIQUE INDEX "InstitutionExamConfig_institutionId_trackCode_key" ON "InstitutionExamConfig"("institutionId", "trackCode");
CREATE INDEX "InstitutionExamConfig_institutionId_isActive_idx" ON "InstitutionExamConfig"("institutionId", "isActive");

ALTER TABLE "InstitutionExamConfig"
ADD CONSTRAINT "InstitutionExamConfig_institutionId_fkey"
FOREIGN KEY ("institutionId") REFERENCES "Institution"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "Institution" ("code", "name", "slug", "isActive", "createdAt", "updatedAt")
VALUES ('UI', 'University of Ibadan', 'ui', true, NOW(), NOW())
ON CONFLICT ("code")
DO UPDATE SET
    "name" = EXCLUDED."name",
    "slug" = EXCLUDED."slug",
    "isActive" = EXCLUDED."isActive",
    "updatedAt" = NOW();

INSERT INTO "InstitutionExamConfig" (
    "institutionId",
    "trackCode",
    "trackName",
    "isActive",
    "questionsPerSubject",
    "fullExamQuestions",
    "maxSubjects",
    "singleSubjectDurationSeconds",
    "twoSubjectDurationSeconds",
    "threeSubjectDurationSeconds",
    "fullExamDurationSeconds",
    "collaborationDurationSeconds",
    "freeRealExamCount",
    "freeFullRealTotalAttempts",
    "premiumDailyRealExamLimit",
    "collaborationGateRealExams",
    "defaultFullExamSource",
    "defaultPartialExamSource",
    "defaultCollabSource",
    "allowMixedPartialExams",
    "allowMixedFullExams",
    "allowPracticeCollaboration",
    "allowMixedCollaboration",
    "additionalRules",
    "createdAt",
    "updatedAt"
)
SELECT
    i."id",
    'POST_UTME',
    'Post-UTME',
    true,
    25,
    100,
    4,
    1320,
    2640,
    3960,
    5400,
    5400,
    1,
    3,
    5,
    2,
    'REAL_PAST_QUESTION'::"InstitutionQuestionSourceMode",
    'MIXED'::"InstitutionQuestionSourceMode",
    'REAL_PAST_QUESTION'::"InstitutionQuestionSourceMode",
    true,
    false,
    true,
    true,
    '{"launchInstitution": true, "schoolCode": "UI"}'::jsonb,
    NOW(),
    NOW()
FROM "Institution" i
WHERE i."code" = 'UI'
ON CONFLICT ("institutionId", "trackCode")
DO UPDATE SET
    "trackName" = EXCLUDED."trackName",
    "isActive" = EXCLUDED."isActive",
    "questionsPerSubject" = EXCLUDED."questionsPerSubject",
    "fullExamQuestions" = EXCLUDED."fullExamQuestions",
    "maxSubjects" = EXCLUDED."maxSubjects",
    "singleSubjectDurationSeconds" = EXCLUDED."singleSubjectDurationSeconds",
    "twoSubjectDurationSeconds" = EXCLUDED."twoSubjectDurationSeconds",
    "threeSubjectDurationSeconds" = EXCLUDED."threeSubjectDurationSeconds",
    "fullExamDurationSeconds" = EXCLUDED."fullExamDurationSeconds",
    "collaborationDurationSeconds" = EXCLUDED."collaborationDurationSeconds",
    "freeRealExamCount" = EXCLUDED."freeRealExamCount",
    "freeFullRealTotalAttempts" = EXCLUDED."freeFullRealTotalAttempts",
    "premiumDailyRealExamLimit" = EXCLUDED."premiumDailyRealExamLimit",
    "collaborationGateRealExams" = EXCLUDED."collaborationGateRealExams",
    "defaultFullExamSource" = EXCLUDED."defaultFullExamSource",
    "defaultPartialExamSource" = EXCLUDED."defaultPartialExamSource",
    "defaultCollabSource" = EXCLUDED."defaultCollabSource",
    "allowMixedPartialExams" = EXCLUDED."allowMixedPartialExams",
    "allowMixedFullExams" = EXCLUDED."allowMixedFullExams",
    "allowPracticeCollaboration" = EXCLUDED."allowPracticeCollaboration",
    "allowMixedCollaboration" = EXCLUDED."allowMixedCollaboration",
    "additionalRules" = EXCLUDED."additionalRules",
    "updatedAt" = NOW();
