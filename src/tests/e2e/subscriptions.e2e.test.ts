import { randomUUID } from 'crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../../app';
import prisma from '../../config/database';
import { hashPassword } from '../../shared/utils/hash';
import { generateTokens } from '../../shared/utils/jwt';
import { paystackClient } from '../../modules/subscriptions/paystack-client';
import { runSubscriptionExpiryCheck } from '../../jobs/subscription-check';

const runIntegration = process.env.RUN_INTEGRATION_TESTS === 'true';
const describeE2E = runIntegration ? describe : describe.skip;

interface SubscriptionFixture {
  userIds: number[];
  sessionIds: string[];
}

function uniqueToken(prefix: string): string {
  return `${prefix}-${Date.now()}-${randomUUID().slice(0, 8)}`;
}

async function createUserFixture(
  fixture: SubscriptionFixture,
  input: Partial<{
    email: string;
    password: string;
    isPremium: boolean;
    deviceAccessMode: 'FREE' | 'PREMIUM';
    authPolicyVersion: number;
    subscriptionEndDate: Date | null;
  }> = {}
) {
  const password = input.password || 'SecurePass123!';
  const user = await prisma.user.create({
    data: {
      email: input.email || `${uniqueToken('subscription-user')}@example.com`,
      passwordHash: await hashPassword(password),
      fullName: uniqueToken('Subscription User'),
      isVerified: true,
      isPremium: input.isPremium ?? false,
      deviceAccessMode: input.deviceAccessMode ?? (input.isPremium ? 'PREMIUM' : 'FREE'),
      authPolicyVersion: input.authPolicyVersion ?? (input.isPremium ? 1 : 0),
      subscriptionEndDate: input.subscriptionEndDate ?? null
    }
  });

  fixture.userIds.push(user.id);
  return { user, password };
}

async function createAuthHeader(
  fixture: SubscriptionFixture,
  user: any,
  options: Partial<{
    deviceId: string;
    authPolicyVersion: number;
    tokenVersion: number;
  }> = {}
): Promise<string> {
  const deviceId = options.deviceId || uniqueToken('subscription-device');
  const authPolicyVersion = options.authPolicyVersion ?? 0;
  const session = await prisma.userSession.create({
    data: {
      userId: user.id,
      deviceId,
      isActive: true,
      authPolicyVersion,
      tokenVersion: options.tokenVersion ?? 0,
      expiresAt: new Date(Date.now() + (24 * 60 * 60 * 1000))
    }
  });

  fixture.sessionIds.push(session.id);

  const tokens = generateTokens(
    {
      id: user.id,
      email: user.email,
      role: user.role
    },
    session.id,
    deviceId,
    session.tokenVersion
  );

  return `Bearer ${tokens.accessToken}`;
}

async function cleanupFixture(fixture: SubscriptionFixture): Promise<void> {
  if (fixture.userIds.length === 0) return;

  await prisma.idempotencyRecord.deleteMany({
    where: { userId: { in: fixture.userIds } }
  });

  await prisma.subscriptionPayment.deleteMany({
    where: { userId: { in: fixture.userIds } }
  });

  await prisma.subscription.deleteMany({
    where: { userId: { in: fixture.userIds } }
  });

  await prisma.auditLog.deleteMany({
    where: { userId: { in: fixture.userIds } }
  });

  await prisma.userSession.deleteMany({
    where: { userId: { in: fixture.userIds } }
  });

  await prisma.userDevice.deleteMany({
    where: { userId: { in: fixture.userIds } }
  });

  await prisma.user.deleteMany({
    where: { id: { in: fixture.userIds } }
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describeE2E('Subscriptions module (HTTP e2e)', () => {
  it('creates a fixed-price Paystack checkout and persists a pending payment ledger row', async () => {
    const fixture: SubscriptionFixture = { userIds: [], sessionIds: [] };
    const app = await buildApp();

    try {
      const { user } = await createUserFixture(fixture, {
        isPremium: false,
        deviceAccessMode: 'FREE'
      });
      const authHeader = await createAuthHeader(fixture, user, { authPolicyVersion: 0 });

      vi.spyOn(paystackClient, 'initializeTransaction').mockResolvedValue({
        provider: 'PAYSTACK',
        checkoutUrl: 'https://checkout.paystack.test/tx/123',
        accessCode: 'access-code-123',
        reference: 'SBSUB-100-init',
        providerPayload: {
          authorization_url: 'https://checkout.paystack.test/tx/123',
          access_code: 'access-code-123',
          reference: 'SBSUB-100-init'
        }
      });

      const response = await app.inject({
        method: 'POST',
        url: '/api/subscriptions/initiate',
        headers: {
          authorization: authHeader,
          'idempotency-key': uniqueToken('idem-initiate')
        },
        payload: {
          autoRenew: true
        }
      });

      expect(response.statusCode).toBe(201);
      expect(response.json()).toMatchObject({
        success: true,
        data: {
          reference: 'SBSUB-100-init',
          accessCode: 'access-code-123',
          amountNaira: 5000,
          autoRenew: true
        }
      });

      const payment = await prisma.subscriptionPayment.findUniqueOrThrow({
        where: { reference: 'SBSUB-100-init' }
      });

      expect(payment.userId).toBe(user.id);
      expect(payment.status).toBe('PENDING');
      expect(payment.requestedAutoRenew).toBe(true);
    } finally {
      await cleanupFixture(fixture);
      await app.close();
    }
  });

  it('activates premium access on successful verification and invalidates old free sessions immediately', async () => {
    const fixture: SubscriptionFixture = { userIds: [], sessionIds: [] };
    const app = await buildApp();

    try {
      const { user } = await createUserFixture(fixture, {
        isPremium: false,
        deviceAccessMode: 'FREE',
        authPolicyVersion: 0
      });
      const authHeader = await createAuthHeader(fixture, user, { authPolicyVersion: 0 });

      await prisma.subscriptionPayment.create({
        data: {
          userId: user.id,
          reference: 'SBSUB-VERIFY-1',
          amountPaid: 5000,
          currency: 'NGN',
          status: 'PENDING',
          requestedAutoRenew: true
        }
      });

      vi.spyOn(paystackClient, 'verifyTransaction').mockResolvedValue({
        provider: 'PAYSTACK',
        reference: 'SBSUB-VERIFY-1',
        paymentStatus: 'SUCCESS',
        amountMinor: 500000,
        currency: 'NGN',
        channel: 'card',
        gatewayResponse: 'Approved',
        paidAt: new Date(),
        metadata: {
          userId: user.id,
          planType: 'PREMIUM_5_MONTH',
          requestedAutoRenew: true
        },
        customerEmail: user.email,
        customerCode: 'CUS_test_123',
        authorizationCode: 'AUTH_test_123',
        authorizationReusable: true,
        authorizationSignature: 'SIG_test_123',
        providerPayload: {
          status: 'success',
          reference: 'SBSUB-VERIFY-1',
          amount: 500000,
          currency: 'NGN'
        },
      });

      const verifyResponse = await app.inject({
        method: 'POST',
        url: '/api/subscriptions/verify',
        headers: {
          authorization: authHeader,
          'idempotency-key': uniqueToken('idem-verify')
        },
        payload: {
          reference: 'SBSUB-VERIFY-1'
        }
      });

      expect(verifyResponse.statusCode).toBe(200);
      expect(verifyResponse.json()).toMatchObject({
        success: true,
        data: {
          activated: true,
          paymentStatus: 'SUCCESS'
        }
      });

      const refreshedUser = await prisma.user.findUniqueOrThrow({
        where: { id: user.id },
        select: {
          isPremium: true,
          deviceAccessMode: true,
          authPolicyVersion: true,
          subscriptionEndDate: true
        }
      });

      expect(refreshedUser.isPremium).toBe(true);
      expect(refreshedUser.deviceAccessMode).toBe('PREMIUM');
      expect(refreshedUser.authPolicyVersion).toBe(1);
      expect(refreshedUser.subscriptionEndDate).not.toBeNull();

      const activeSessions = await prisma.userSession.count({
        where: {
          userId: user.id,
          isActive: true
        }
      });
      const deviceCount = await prisma.userDevice.count({
        where: { userId: user.id }
      });

      expect(activeSessions).toBe(0);
      expect(deviceCount).toBe(0);

      const meResponse = await app.inject({
        method: 'GET',
        url: '/api/auth/me',
        headers: {
          authorization: authHeader
        }
      });

      expect(meResponse.statusCode).toBe(401);
    } finally {
      await cleanupFixture(fixture);
      await app.close();
    }
  }, 120000);

  it('does not extend the same premium payment twice when verification is retried', async () => {
    const fixture: SubscriptionFixture = { userIds: [], sessionIds: [] };
    const app = await buildApp();

    try {
      const originalEndDate = new Date(Date.now() + (15 * 24 * 60 * 60 * 1000));
      const { user } = await createUserFixture(fixture, {
        isPremium: true,
        deviceAccessMode: 'PREMIUM',
        authPolicyVersion: 1,
        subscriptionEndDate: originalEndDate
      });
      const authHeader = await createAuthHeader(fixture, user, {
        authPolicyVersion: 1,
        deviceId: 'premium-device-known'
      });

      await prisma.subscription.create({
        data: {
          userId: user.id,
          planType: 'PREMIUM_5_MONTH',
          amountPaid: 5000,
          paymentReference: 'SBSUB-VERIFY-2',
          status: 'ACTIVE',
          startDate: new Date(Date.now() - (15 * 24 * 60 * 60 * 1000)),
          endDate: originalEndDate,
          autoRenew: true
        }
      });

      await prisma.subscriptionPayment.create({
        data: {
          userId: user.id,
          reference: 'SBSUB-VERIFY-2',
          amountPaid: 5000,
          currency: 'NGN',
          status: 'PENDING',
          requestedAutoRenew: true
        }
      });

      vi.spyOn(paystackClient, 'verifyTransaction').mockResolvedValue({
        provider: 'PAYSTACK',
        reference: 'SBSUB-VERIFY-2',
        paymentStatus: 'SUCCESS',
        amountMinor: 500000,
        currency: 'NGN',
        channel: 'card',
        gatewayResponse: 'Approved',
        paidAt: new Date(),
        metadata: {
          userId: user.id,
          planType: 'PREMIUM_5_MONTH',
          requestedAutoRenew: true
        },
        customerEmail: user.email,
        customerCode: 'CUS_test_456',
        authorizationCode: 'AUTH_test_456',
        authorizationReusable: true,
        authorizationSignature: 'SIG_test_456',
        providerPayload: {
          status: 'success',
          reference: 'SBSUB-VERIFY-2',
          amount: 500000,
          currency: 'NGN'
        },
      });

      const firstVerify = await app.inject({
        method: 'POST',
        url: '/api/subscriptions/verify',
        headers: {
          authorization: authHeader,
          'idempotency-key': uniqueToken('idem-verify-first')
        },
        payload: {
          reference: 'SBSUB-VERIFY-2'
        }
      });

      expect(firstVerify.statusCode).toBe(200);

      const subscriptionAfterFirstVerify = await prisma.subscription.findUniqueOrThrow({
        where: { userId: user.id }
      });

      const secondVerify = await app.inject({
        method: 'POST',
        url: '/api/subscriptions/verify',
        headers: {
          authorization: authHeader,
          'idempotency-key': uniqueToken('idem-verify-second')
        },
        payload: {
          reference: 'SBSUB-VERIFY-2'
        }
      });

      expect(secondVerify.statusCode).toBe(200);
      expect(secondVerify.json()).toMatchObject({
        success: true,
        data: {
          activated: true,
          paymentStatus: 'SUCCESS'
        }
      });

      const subscriptionAfterSecondVerify = await prisma.subscription.findUniqueOrThrow({
        where: { userId: user.id }
      });

      expect(subscriptionAfterSecondVerify.endDate.toISOString()).toBe(subscriptionAfterFirstVerify.endDate.toISOString());
    } finally {
      await cleanupFixture(fixture);
      await app.close();
    }
  }, 120000);

  it('turns off auto-renew and expires due subscriptions through the reconciliation job', async () => {
    const fixture: SubscriptionFixture = { userIds: [], sessionIds: [] };
    const app = await buildApp();

    try {
      const activeEndDate = new Date(Date.now() + (2 * 24 * 60 * 60 * 1000));
      const expiredEndDate = new Date(Date.now() - (2 * 24 * 60 * 60 * 1000));
      const { user } = await createUserFixture(fixture, {
        isPremium: true,
        deviceAccessMode: 'PREMIUM',
        authPolicyVersion: 1,
        subscriptionEndDate: activeEndDate
      });
      const authHeader = await createAuthHeader(fixture, user, {
        authPolicyVersion: 1,
        deviceId: 'premium-device-expiring'
      });

      await prisma.userDevice.create({
        data: {
          userId: user.id,
          deviceId: 'premium-device-expiring',
          deviceName: 'Premium Device',
          userAgent: 'Mozilla/5.0',
          fingerprintHash: 'device-hash',
          fingerprintData: { browserName: 'chrome' },
          isVerified: true,
          isActive: true
        }
      });

      await prisma.subscription.create({
        data: {
          userId: user.id,
          planType: 'PREMIUM_5_MONTH',
          amountPaid: 5000,
          paymentReference: 'SBSUB-CANCEL-1',
          status: 'ACTIVE',
          startDate: new Date(Date.now() - (150 * 24 * 60 * 60 * 1000)),
          endDate: activeEndDate,
          autoRenew: true
        }
      });

      const cancelResponse = await app.inject({
        method: 'POST',
        url: '/api/subscriptions/cancel',
        headers: {
          authorization: authHeader,
          'idempotency-key': uniqueToken('idem-cancel')
        },
        payload: {
          reason: 'manual opt out'
        }
      });

      expect(cancelResponse.statusCode).toBe(200);
      expect(cancelResponse.json()).toMatchObject({
        success: true,
        data: {
          autoRenew: false
        }
      });

      await prisma.subscription.update({
        where: { userId: user.id },
        data: {
          endDate: expiredEndDate,
          status: 'ACTIVE'
        }
      });

      await prisma.user.update({
        where: { id: user.id },
        data: {
          subscriptionEndDate: expiredEndDate,
          isPremium: true,
          deviceAccessMode: 'PREMIUM'
        }
      });

      const expired = await runSubscriptionExpiryCheck();
      expect(expired.expiredUsers).toBeGreaterThanOrEqual(1);

      const refreshedUser = await prisma.user.findUniqueOrThrow({
        where: { id: user.id },
        select: {
          isPremium: true,
          deviceAccessMode: true
        }
      });
      const refreshedSubscription = await prisma.subscription.findUniqueOrThrow({
        where: { userId: user.id }
      });
      const deviceCount = await prisma.userDevice.count({
        where: { userId: user.id }
      });

      expect(refreshedUser.isPremium).toBe(false);
      expect(refreshedUser.deviceAccessMode).toBe('FREE');
      expect(refreshedSubscription.status).toBe('EXPIRED');
      expect(deviceCount).toBe(0);
    } finally {
      await cleanupFixture(fixture);
      await app.close();
    }
  }, 120000);
});
