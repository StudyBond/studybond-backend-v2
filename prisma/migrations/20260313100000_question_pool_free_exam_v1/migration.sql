-- CreateEnum
CREATE TYPE "QuestionPool" AS ENUM ('FREE_EXAM', 'REAL_UI', 'PRACTICE');

-- AlterTable
ALTER TABLE "Question"
ADD COLUMN "questionPool" "QuestionPool" NOT NULL DEFAULT 'REAL_UI';

-- Backfill practice-oriented rows into PRACTICE pool.
UPDATE "Question"
SET "questionPool" = 'PRACTICE'
WHERE "questionType" IN ('practice', 'ai_generated');

-- CreateIndex
CREATE INDEX "Question_questionPool_idx" ON "Question"("questionPool");

-- CreateIndex
CREATE INDEX "Question_subject_questionPool_idx" ON "Question"("subject", "questionPool");
