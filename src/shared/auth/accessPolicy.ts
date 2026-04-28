import { PremiumEntitlementStatus, Prisma, SubscriptionStatus } from '@prisma/client';
import { prisma } from '../../config/database';
import { AUTH_CONFIG } from '../../config/constants';

export const authManagedUserSelect = {
  id: true,
  email: true,
  passwordHash: true,
  fullName: true,
  role: true,
  isVerified: true,
  verificationToken: true,
  tokenExpiresAt: true,
  otpRequestCount: true,
  lastOtpRequestDate: true,
  isPremium: true,
  subscriptionEndDate: true,
  deviceAccessMode: true,
  authPolicyVersion: true,
  isBanned: true,
  bannedReason: true
} satisfies Prisma.UserSelect;

export type AuthManagedUser = Prisma.UserGetPayload<{
  select: typeof authManagedUserSelect;
}>;

export type AuthTx = Prisma.TransactionClient;

function sameTimestamp(left: Date | null | undefined, right: Date | null | undefined): boolean {
  if (!left && !right) return true;
  if (!left || !right) return false;
  return left.getTime() === right.getTime();
}

async function expirePremiumSourcesTx(tx: AuthTx, userId: number, now: Date): Promise<void> {
  await Promise.all([
    tx.subscription.updateMany({
      where: {
        userId,
        status: SubscriptionStatus.ACTIVE,
        endDate: { lte: now }
      },
      data: {
        status: SubscriptionStatus.EXPIRED
      }
    }),
    tx.premiumEntitlement.updateMany({
      where: {
        userId,
        status: PremiumEntitlementStatus.ACTIVE,
        endsAt: { lte: now }
      },
      data: {
        status: PremiumEntitlementStatus.EXPIRED
      }
    })
  ]);
}

async function computePremiumProjectionTx(
  tx: AuthTx,
  userId: number,
  now: Date
): Promise<{ isPremium: boolean; effectiveEndDate: Date | null }> {
  type CoverageWindow = {
    startsAt: Date;
    endsAt: Date;
  };

  const [subscription, entitlements] = await Promise.all([
    tx.subscription.findUnique({
      where: { userId },
      select: {
        status: true,
        startDate: true,
        endDate: true
      }
    }),
    tx.premiumEntitlement.findMany({
      where: {
        userId,
        status: PremiumEntitlementStatus.ACTIVE,
        endsAt: { gt: now }
      },
      select: {
        startsAt: true,
        endsAt: true
      }
    })
  ]);

  const windows: CoverageWindow[] = [];
  if (
    subscription?.status === SubscriptionStatus.ACTIVE &&
    subscription.endDate > now
  ) {
    windows.push({
      startsAt: subscription.startDate,
      endsAt: subscription.endDate
    });
  }

  for (const entitlement of entitlements) {
    windows.push({
      startsAt: entitlement.startsAt,
      endsAt: entitlement.endsAt
    });
  }

  const activeWindows = windows.filter((window) => window.startsAt <= now && window.endsAt > now);
  if (activeWindows.length === 0) {
    return {
      isPremium: false,
      effectiveEndDate: null
    };
  }

  let effectiveEndDate = activeWindows.reduce(
    (latest, window) => window.endsAt > latest ? window.endsAt : latest,
    activeWindows[0].endsAt
  );

  let extended = true;
  while (extended) {
    extended = false;

    for (const window of windows) {
      if (window.startsAt <= effectiveEndDate && window.endsAt > effectiveEndDate) {
        effectiveEndDate = window.endsAt;
        extended = true;
      }
    }
  }

  return {
    isPremium: true,
    effectiveEndDate
  };
}

async function loadAuthManagedUser(
  tx: AuthTx,
  userId: number,
  lockRow: boolean
): Promise<AuthManagedUser | null> {
  if (lockRow) {
    await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`;
  }

  return tx.user.findUnique({
    where: { id: userId },
    select: authManagedUserSelect
  });
}

export async function getLockedAuthManagedUser(tx: AuthTx, userId: number): Promise<AuthManagedUser | null> {
  return loadAuthManagedUser(tx, userId, true);
}

export async function getAuthManagedUser(tx: AuthTx, userId: number): Promise<AuthManagedUser | null> {
  return loadAuthManagedUser(tx, userId, false);
}

export async function syncAuthAccessModeTx(
  tx: AuthTx,
  user: AuthManagedUser
): Promise<AuthManagedUser> {
  let managedUser = user;

  if (managedUser.isPremium && managedUser.deviceAccessMode !== 'PREMIUM') {
    await tx.userSession.updateMany({
      where: {
        userId: managedUser.id,
        isActive: true
      },
      data: {
        isActive: false
      }
    });

    await tx.userDevice.deleteMany({
      where: { userId: managedUser.id }
    });

    return tx.user.update({
      where: { id: managedUser.id },
      data: {
        deviceAccessMode: 'PREMIUM',
        authPolicyVersion: { increment: 1 },
        otpRequestCount: 0,
        lastOtpRequestDate: null
      },
      select: authManagedUserSelect
    });
  }

  if (!managedUser.isPremium && managedUser.deviceAccessMode !== 'FREE') {
    await tx.userDevice.deleteMany({
      where: { userId: managedUser.id }
    });

    return tx.user.update({
      where: { id: managedUser.id },
      data: {
        deviceAccessMode: 'FREE',
        otpRequestCount: 0,
        lastOtpRequestDate: null
      },
      select: authManagedUserSelect
    });
  }

  return managedUser;
}

export async function reconcilePremiumAccessTx(tx: AuthTx, userId: number): Promise<AuthManagedUser | null> {
  const lockedUser = await getLockedAuthManagedUser(tx, userId);
  if (!lockedUser) return null;

  const now = new Date();
  await expirePremiumSourcesTx(tx, userId, now);

  const projection = await computePremiumProjectionTx(tx, userId, now);

  let managedUser = lockedUser;
  if (
    managedUser.isPremium !== projection.isPremium ||
    !sameTimestamp(managedUser.subscriptionEndDate, projection.effectiveEndDate)
  ) {
    managedUser = await tx.user.update({
      where: { id: userId },
      data: {
        isPremium: projection.isPremium,
        subscriptionEndDate: projection.effectiveEndDate
      },
      select: authManagedUserSelect
    });
  }

  return syncAuthAccessModeTx(tx, managedUser);
}

export async function reconcileAuthAccessMode(userId: number): Promise<AuthManagedUser | null> {
  return prisma.$transaction(
    async (tx: AuthTx) => reconcilePremiumAccessTx(tx, userId),
    {
      maxWait: AUTH_CONFIG.TX_MAX_WAIT_MS,
      timeout: AUTH_CONFIG.TX_TIMEOUT_MS
    }
  );
}
