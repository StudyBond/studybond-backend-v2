CREATE TABLE "AdminAnalyticsDailyRollup" (
    "date" DATE NOT NULL,
    "newUsers" INTEGER NOT NULL DEFAULT 0,
    "examsStarted" INTEGER NOT NULL DEFAULT 0,
    "examsCompleted" INTEGER NOT NULL DEFAULT 0,
    "collaborationSessions" INTEGER NOT NULL DEFAULT 0,
    "successfulPayments" INTEGER NOT NULL DEFAULT 0,
    "successfulRevenueNaira" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "manualPremiumGrants" INTEGER NOT NULL DEFAULT 0,
    "promotionalPremiumGrants" INTEGER NOT NULL DEFAULT 0,
    "correctivePremiumGrants" INTEGER NOT NULL DEFAULT 0,
    "premiumRevocations" INTEGER NOT NULL DEFAULT 0,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdminAnalyticsDailyRollup_pkey" PRIMARY KEY ("date")
);

CREATE INDEX "AdminAnalyticsDailyRollup_updatedAt_idx"
ON "AdminAnalyticsDailyRollup"("updatedAt");
