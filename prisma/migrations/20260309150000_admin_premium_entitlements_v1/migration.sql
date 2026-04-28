ALTER TYPE "AdminAuditAction" ADD VALUE IF NOT EXISTS 'PREMIUM_GRANTED';
ALTER TYPE "AdminAuditAction" ADD VALUE IF NOT EXISTS 'PREMIUM_EXTENDED';
ALTER TYPE "AdminAuditAction" ADD VALUE IF NOT EXISTS 'PREMIUM_REVOKED';

ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'PREMIUM_GRANTED_MANUALLY';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'PREMIUM_EXTENDED_MANUALLY';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'PREMIUM_REVOKED_MANUALLY';

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'PremiumEntitlementKind') THEN
        CREATE TYPE "PremiumEntitlementKind" AS ENUM ('MANUAL', 'PROMOTIONAL', 'CORRECTIVE');
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'PremiumEntitlementStatus') THEN
        CREATE TYPE "PremiumEntitlementStatus" AS ENUM ('ACTIVE', 'REVOKED', 'EXPIRED');
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS "PremiumEntitlement" (
    "id" BIGSERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "grantedByAdminId" INTEGER NOT NULL,
    "revokedByAdminId" INTEGER,
    "kind" "PremiumEntitlementKind" NOT NULL,
    "status" "PremiumEntitlementStatus" NOT NULL DEFAULT 'ACTIVE',
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "note" TEXT NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PremiumEntitlement_pkey" PRIMARY KEY ("id")
);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'PremiumEntitlement_userId_fkey'
    ) THEN
        ALTER TABLE "PremiumEntitlement"
            ADD CONSTRAINT "PremiumEntitlement_userId_fkey"
            FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'PremiumEntitlement_grantedByAdminId_fkey'
    ) THEN
        ALTER TABLE "PremiumEntitlement"
            ADD CONSTRAINT "PremiumEntitlement_grantedByAdminId_fkey"
            FOREIGN KEY ("grantedByAdminId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'PremiumEntitlement_revokedByAdminId_fkey'
    ) THEN
        ALTER TABLE "PremiumEntitlement"
            ADD CONSTRAINT "PremiumEntitlement_revokedByAdminId_fkey"
            FOREIGN KEY ("revokedByAdminId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS "PremiumEntitlement_userId_status_endsAt_idx"
    ON "PremiumEntitlement"("userId", "status", "endsAt");
CREATE INDEX IF NOT EXISTS "PremiumEntitlement_userId_startsAt_endsAt_idx"
    ON "PremiumEntitlement"("userId", "startsAt", "endsAt");
CREATE INDEX IF NOT EXISTS "PremiumEntitlement_grantedByAdminId_createdAt_idx"
    ON "PremiumEntitlement"("grantedByAdminId", "createdAt");
CREATE INDEX IF NOT EXISTS "PremiumEntitlement_revokedByAdminId_createdAt_idx"
    ON "PremiumEntitlement"("revokedByAdminId", "createdAt");
