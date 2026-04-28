ALTER TABLE "Question"
  ADD COLUMN "imagePublicId" TEXT,
  ADD COLUMN "optionAImagePublicId" TEXT,
  ADD COLUMN "optionBImagePublicId" TEXT,
  ADD COLUMN "optionCImagePublicId" TEXT,
  ADD COLUMN "optionDImagePublicId" TEXT,
  ADD COLUMN "optionEImagePublicId" TEXT;

ALTER TABLE "Explanation"
  ADD COLUMN "explanationImagePublicId" TEXT;
