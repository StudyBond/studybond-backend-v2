import { PremiumEntitlementStatus, Prisma, SubscriptionStatus } from '@prisma/client';
import type { PremiumCoverageState } from './admin.types';

type PremiumCoverageClient = Pick<Prisma.TransactionClient, 'subscription' | 'premiumEntitlement'>;

type CoverageWindow = {
    startsAt: Date;
    endsAt: Date;
    sourceType: 'SUBSCRIPTION' | 'ADMIN_ENTITLEMENT';
};

export async function buildPremiumCoverageStateTx(tx: PremiumCoverageClient, userId: number): Promise<PremiumCoverageState> {
    const now = new Date();
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
            endsAt: subscription.endDate,
            sourceType: 'SUBSCRIPTION'
        });
    }

    for (const entitlement of entitlements) {
        windows.push({
            startsAt: entitlement.startsAt,
            endsAt: entitlement.endsAt,
            sourceType: 'ADMIN_ENTITLEMENT'
        });
    }

    const activeWindows = windows.filter((window) => window.startsAt <= now && window.endsAt > now);
    if (activeWindows.length === 0) {
        return {
            isPremium: false,
            effectiveEndDate: null,
            activeSourceTypes: []
        };
    }

    let effectiveEndDate = activeWindows.reduce(
        (latest, window) => (window.endsAt > latest ? window.endsAt : latest),
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
        effectiveEndDate,
        activeSourceTypes: Array.from(new Set(activeWindows.map((window) => window.sourceType)))
    };
}
