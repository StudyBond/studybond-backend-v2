ALTER TYPE "AdminAuditAction" ADD VALUE IF NOT EXISTS 'STEP_UP_CHALLENGE_REQUESTED';
ALTER TYPE "AdminAuditAction" ADD VALUE IF NOT EXISTS 'STEP_UP_CHALLENGE_VERIFIED';
ALTER TYPE "AdminAuditAction" ADD VALUE IF NOT EXISTS 'STEP_UP_CHALLENGE_FAILED';

DO $$
BEGIN
    CREATE TYPE "AdminStepUpPurpose" AS ENUM ('SUPERADMIN_SENSITIVE_ACTION');
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "AdminStepUpChallenge" (
    "id" TEXT NOT NULL,
    "actorId" INTEGER NOT NULL,
    "sessionId" TEXT NOT NULL,
    "purpose" "AdminStepUpPurpose" NOT NULL,
    "otpHash" TEXT,
    "otpExpiresAt" TIMESTAMP(3),
    "verifiedTokenHash" TEXT,
    "verifiedTokenExpiresAt" TIMESTAMP(3),
    "verifiedAt" TIMESTAMP(3),
    "failedAttempts" INTEGER NOT NULL DEFAULT 0,
    "lastUsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdminStepUpChallenge_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "AdminStepUpChallenge_actorId_sessionId_purpose_key"
    ON "AdminStepUpChallenge"("actorId", "sessionId", "purpose");

CREATE INDEX IF NOT EXISTS "AdminStepUpChallenge_actorId_purpose_createdAt_idx"
    ON "AdminStepUpChallenge"("actorId", "purpose", "createdAt");

CREATE INDEX IF NOT EXISTS "AdminStepUpChallenge_sessionId_purpose_verifiedTokenExpiresAt_idx"
    ON "AdminStepUpChallenge"("sessionId", "purpose", "verifiedTokenExpiresAt");

DO $$
BEGIN
    ALTER TABLE "AdminStepUpChallenge"
        ADD CONSTRAINT "AdminStepUpChallenge_actorId_fkey"
        FOREIGN KEY ("actorId") REFERENCES "User"("id")
        ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
    ALTER TABLE "AdminStepUpChallenge"
        ADD CONSTRAINT "AdminStepUpChallenge_sessionId_fkey"
        FOREIGN KEY ("sessionId") REFERENCES "UserSession"("id")
        ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;
