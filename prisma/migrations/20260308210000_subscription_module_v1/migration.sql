CREATE TYPE "PaymentProvider" AS ENUM ('PAYSTACK');

CREATE TYPE "SubscriptionPaymentStatus" AS ENUM (
  'PENDING',
  'SUCCESS',
  'FAILED',
  'ABANDONED',
  'REVERSED'
);

ALTER TABLE "Subscription"
ADD COLUMN "provider" "PaymentProvider" NOT NULL DEFAULT 'PAYSTACK',
ADD COLUMN "cancelledAt" TIMESTAMP(3),
ADD COLUMN "customerCode" TEXT,
ADD COLUMN "authorizationCode" TEXT,
ADD COLUMN "authorizationSignature" TEXT,
ADD COLUMN "authorizationReusable" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "lastPaymentVerifiedAt" TIMESTAMP(3),
ADD COLUMN "renewalFailureCount" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE "SubscriptionPayment" (
  "id" BIGSERIAL NOT NULL,
  "userId" INTEGER NOT NULL,
  "subscriptionId" INTEGER,
  "provider" "PaymentProvider" NOT NULL DEFAULT 'PAYSTACK',
  "reference" TEXT NOT NULL,
  "accessCode" TEXT,
  "status" "SubscriptionPaymentStatus" NOT NULL DEFAULT 'PENDING',
  "amountPaid" DECIMAL(10,2) NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'NGN',
  "channel" TEXT,
  "gatewayResponse" TEXT,
  "requestedAutoRenew" BOOLEAN NOT NULL DEFAULT false,
  "customerCode" TEXT,
  "authorizationCode" TEXT,
  "authorizationSignature" TEXT,
  "providerPayload" JSONB,
  "paidAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "SubscriptionPayment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SubscriptionPayment_reference_key" ON "SubscriptionPayment"("reference");
CREATE INDEX "Subscription_status_endDate_idx" ON "Subscription"("status", "endDate");
CREATE INDEX "Subscription_autoRenew_endDate_idx" ON "Subscription"("autoRenew", "endDate");
CREATE INDEX "SubscriptionPayment_userId_status_createdAt_idx" ON "SubscriptionPayment"("userId", "status", "createdAt");
CREATE INDEX "SubscriptionPayment_subscriptionId_createdAt_idx" ON "SubscriptionPayment"("subscriptionId", "createdAt");
CREATE INDEX "SubscriptionPayment_status_createdAt_idx" ON "SubscriptionPayment"("status", "createdAt");

ALTER TABLE "SubscriptionPayment"
ADD CONSTRAINT "SubscriptionPayment_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SubscriptionPayment"
ADD CONSTRAINT "SubscriptionPayment_subscriptionId_fkey"
FOREIGN KEY ("subscriptionId") REFERENCES "Subscription"("id") ON DELETE SET NULL ON UPDATE CASCADE;
