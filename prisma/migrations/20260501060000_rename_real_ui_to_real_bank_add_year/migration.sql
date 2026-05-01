-- ============================================================
-- Migration: Rename QuestionPool REAL_UI → REAL_BANK + Add year
-- ============================================================
-- Context:
--   The enum value REAL_UI was institution-specific (University of Ibadan).
--   Renamed to REAL_BANK to support multi-institution expansion.
--   The "year" column is added as nullable metadata for historical filtering.
-- ============================================================

-- Step 1: Rename the enum value.
-- PostgreSQL 10+ supports ALTER TYPE ... RENAME VALUE.
-- This atomically updates every row that currently holds REAL_UI.
ALTER TYPE "QuestionPool" RENAME VALUE 'REAL_UI' TO 'REAL_BANK';

-- Step 2: Update the column default expression.
-- The original migration set DEFAULT 'REAL_UI'. After the rename,
-- that expression references a label that no longer exists.
-- We must reset it to use the new label.
ALTER TABLE "Question"
  ALTER COLUMN "questionPool" SET DEFAULT 'REAL_BANK'::"QuestionPool";

-- Step 3: Add the nullable year column for historical question metadata.
ALTER TABLE "Question" ADD COLUMN "year" INTEGER;

-- Step 4: Create the composite index declared in schema.prisma.
CREATE INDEX IF NOT EXISTS "Question_institutionId_subject_year_idx"
  ON "Question"("institutionId", "subject", "year");
