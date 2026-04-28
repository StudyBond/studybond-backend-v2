CREATE TYPE "DeviceAccessMode" AS ENUM ('FREE', 'PREMIUM');

CREATE TYPE "DeviceRegistrationMethod" AS ENUM ('PREMIUM_FIRST_LOGIN', 'PREMIUM_OTP');

ALTER TABLE "User"
ADD COLUMN "deviceAccessMode" "DeviceAccessMode" NOT NULL DEFAULT 'FREE',
ADD COLUMN "authPolicyVersion" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "UserDevice"
ADD COLUMN "fingerprintHash" TEXT,
ADD COLUMN "fingerprintData" JSONB,
ADD COLUMN "lastIpAddress" TEXT,
ADD COLUMN "verificationTokenHash" TEXT,
ADD COLUMN "verificationTokenExpiresAt" TIMESTAMP(3),
ADD COLUMN "verifiedAt" TIMESTAMP(3),
ADD COLUMN "registrationMethod" "DeviceRegistrationMethod";

ALTER TABLE "UserSession"
ADD COLUMN "authPolicyVersion" INTEGER NOT NULL DEFAULT 0;

CREATE INDEX "UserDevice_userId_isVerified_idx" ON "UserDevice"("userId", "isVerified");
CREATE INDEX "UserDevice_userId_fingerprintHash_idx" ON "UserDevice"("userId", "fingerprintHash");
CREATE INDEX "UserSession_userId_authPolicyVersion_isActive_idx" ON "UserSession"("userId", "authPolicyVersion", "isActive");
