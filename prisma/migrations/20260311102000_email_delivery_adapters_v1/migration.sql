ALTER TYPE "EmailType" ADD VALUE IF NOT EXISTS 'ADMIN_STEP_UP_OTP';

DO $$
BEGIN
    CREATE TYPE "EmailProvider" AS ENUM ('BREVO', 'RESEND');
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "EmailLog"
    ADD COLUMN IF NOT EXISTS "provider" "EmailProvider",
    ADD COLUMN IF NOT EXISTS "recipientEmail" TEXT,
    ADD COLUMN IF NOT EXISTS "subject" TEXT,
    ADD COLUMN IF NOT EXISTS "errorMessage" TEXT,
    ADD COLUMN IF NOT EXISTS "metadata" JSONB;

CREATE INDEX IF NOT EXISTS "EmailLog_provider_sentAt_idx"
    ON "EmailLog"("provider", "sentAt");

CREATE INDEX IF NOT EXISTS "EmailLog_status_sentAt_idx"
    ON "EmailLog"("status", "sentAt");
