-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "EmailType" ADD VALUE 'INACTIVITY_NUDGE';
ALTER TYPE "EmailType" ADD VALUE 'MILESTONE_CELEBRATION';

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "emailPreferences" JSONB;

-- CreateIndex
CREATE INDEX "EmailLog_userId_emailType_status_sentAt_idx" ON "EmailLog"("userId", "emailType", "status", "sentAt");
