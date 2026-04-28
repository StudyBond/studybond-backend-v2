-- Free Exam System Overhaul
-- Replaces daily credit reset with lifetime credits, adds admin question curation via isFeaturedFree

-- AlterEnum
ALTER TYPE "AdminAuditAction" ADD VALUE 'FREE_EXAM_CREDITS_RESET';
ALTER TYPE "AdminAuditAction" ADD VALUE 'FREE_EXAM_QUESTIONS_TOGGLED';

-- User: lifetime credit tracking
ALTER TABLE "User" ADD COLUMN "freeSubjectCreditsUsed" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "User" ADD COLUMN "freeSubjectsTaken" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- Question: featured free flag (replaces questionPool-based curation)
ALTER TABLE "Question" ADD COLUMN "isFeaturedFree" BOOLEAN NOT NULL DEFAULT false;

-- InstitutionExamConfig: per-institution free question limits
ALTER TABLE "InstitutionExamConfig" ADD COLUMN "freeQuestionsPerSubject" INTEGER NOT NULL DEFAULT 25;

-- Index for efficient free question lookup (partial index for queries filtering isFeaturedFree=true)
CREATE INDEX "Question_institutionId_subject_isFeaturedFree_idx" ON "Question"("institutionId", "subject", "isFeaturedFree");

-- Migrate existing FREE_EXAM pool questions: mark them as isFeaturedFree
UPDATE "Question" SET "isFeaturedFree" = true WHERE "questionPool" = 'FREE_EXAM';

-- Backfill freeSubjectCreditsUsed for users who already took their free exam
UPDATE "User" SET "freeSubjectCreditsUsed" = 4 WHERE "hasTakenFreeExam" = true AND "isPremium" = false;
