ALTER TYPE "AdminAuditAction" ADD VALUE IF NOT EXISTS 'NOTIFICATION_ANNOUNCEMENT_CREATED';
ALTER TYPE "AdminAuditAction" ADD VALUE IF NOT EXISTS 'NOTIFICATION_ANNOUNCEMENT_CANCELLED';

DO $$
BEGIN
  CREATE TYPE "NotificationKind" AS ENUM (
    'STREAK_MILESTONE',
    'STREAK_FREEZER_AWARDED',
    'STREAK_AT_RISK',
    'ACHIEVEMENT_UNLOCKED',
    'SUBSCRIPTION_ACTIVATED',
    'SUBSCRIPTION_EXTENDED',
    'SUBSCRIPTION_EXPIRY_WARNING',
    'SUBSCRIPTION_EXPIRED',
    'REPORT_REVIEWED',
    'REPORT_RESOLVED',
    'COLLAB_SESSION_STARTED',
    'COLLAB_SESSION_CANCELLED',
    'COLLAB_SESSION_COMPLETED'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE "NotificationCategory" AS ENUM (
    'STREAKS',
    'ACHIEVEMENTS',
    'COLLABORATION',
    'SUBSCRIPTION',
    'REPORTS',
    'ANNOUNCEMENTS'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE "NotificationPriority" AS ENUM (
    'LOW',
    'DEFAULT',
    'HIGH',
    'URGENT'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE "NotificationAnnouncementAudience" AS ENUM (
    'ALL',
    'PREMIUM',
    'FREE'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "User"
  ADD COLUMN IF NOT EXISTS "notificationPreferences" JSONB;

CREATE TABLE IF NOT EXISTS "UserNotification" (
  "id" BIGSERIAL NOT NULL,
  "userId" INTEGER NOT NULL,
  "kind" "NotificationKind" NOT NULL,
  "category" "NotificationCategory" NOT NULL,
  "priority" "NotificationPriority" NOT NULL DEFAULT 'DEFAULT',
  "title" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "deeplink" TEXT,
  "payload" JSONB,
  "dedupKey" TEXT NOT NULL,
  "sourceType" TEXT NOT NULL,
  "sourceId" TEXT,
  "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3),
  "readAt" TIMESTAMP(3),
  "dismissedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "UserNotification_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "UserNotification_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "NotificationAnnouncement" (
  "id" BIGSERIAL NOT NULL,
  "title" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "deeplink" TEXT,
  "priority" "NotificationPriority" NOT NULL DEFAULT 'DEFAULT',
  "targetAudience" "NotificationAnnouncementAudience" NOT NULL DEFAULT 'ALL',
  "institutionId" INTEGER,
  "verifiedOnly" BOOLEAN NOT NULL DEFAULT false,
  "startAt" TIMESTAMP(3) NOT NULL,
  "expiresAt" TIMESTAMP(3),
  "cancelledAt" TIMESTAMP(3),
  "createdByAdminId" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "NotificationAnnouncement_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "NotificationAnnouncement_institutionId_fkey"
    FOREIGN KEY ("institutionId") REFERENCES "Institution"("id")
    ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "NotificationAnnouncement_createdByAdminId_fkey"
    FOREIGN KEY ("createdByAdminId") REFERENCES "User"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "NotificationAnnouncementReceipt" (
  "id" BIGSERIAL NOT NULL,
  "announcementId" BIGINT NOT NULL,
  "userId" INTEGER NOT NULL,
  "readAt" TIMESTAMP(3),
  "dismissedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "NotificationAnnouncementReceipt_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "NotificationAnnouncementReceipt_announcementId_fkey"
    FOREIGN KEY ("announcementId") REFERENCES "NotificationAnnouncement"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "NotificationAnnouncementReceipt_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "UserNotification_userId_dedupKey_key"
  ON "UserNotification"("userId", "dedupKey");

CREATE INDEX IF NOT EXISTS "UserNotification_userId_createdAt_idx"
  ON "UserNotification"("userId", "createdAt");

CREATE INDEX IF NOT EXISTS "UserNotification_userId_readAt_createdAt_idx"
  ON "UserNotification"("userId", "readAt", "createdAt");

CREATE INDEX IF NOT EXISTS "UserNotification_userId_dismissedAt_createdAt_idx"
  ON "UserNotification"("userId", "dismissedAt", "createdAt");

CREATE INDEX IF NOT EXISTS "UserNotification_availableAt_expiresAt_idx"
  ON "UserNotification"("availableAt", "expiresAt");

CREATE INDEX IF NOT EXISTS "UserNotification_category_createdAt_idx"
  ON "UserNotification"("category", "createdAt");

CREATE INDEX IF NOT EXISTS "NotificationAnnouncement_startAt_expiresAt_cancelledAt_idx"
  ON "NotificationAnnouncement"("startAt", "expiresAt", "cancelledAt");

CREATE INDEX IF NOT EXISTS "NotificationAnnouncement_targetAudience_startAt_cancelledAt_idx"
  ON "NotificationAnnouncement"("targetAudience", "startAt", "cancelledAt");

CREATE INDEX IF NOT EXISTS "NotificationAnnouncement_institutionId_startAt_cancelledAt_idx"
  ON "NotificationAnnouncement"("institutionId", "startAt", "cancelledAt");

CREATE INDEX IF NOT EXISTS "NotificationAnnouncement_createdByAdminId_createdAt_idx"
  ON "NotificationAnnouncement"("createdByAdminId", "createdAt");

CREATE UNIQUE INDEX IF NOT EXISTS "NotificationAnnouncementReceipt_announcementId_userId_key"
  ON "NotificationAnnouncementReceipt"("announcementId", "userId");

CREATE INDEX IF NOT EXISTS "NotificationAnnouncementReceipt_userId_createdAt_idx"
  ON "NotificationAnnouncementReceipt"("userId", "createdAt");

CREATE INDEX IF NOT EXISTS "NotificationAnnouncementReceipt_announcementId_createdAt_idx"
  ON "NotificationAnnouncementReceipt"("announcementId", "createdAt");
