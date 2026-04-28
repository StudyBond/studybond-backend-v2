import { randomBytes } from 'crypto';
import { FastifyInstance } from 'fastify';
import { PaymentProvider, Prisma, SubscriptionPaymentStatus, SubscriptionStatus } from '@prisma/client';
import prisma from '../../config/database';
import { AUTH_CONFIG, SUBSCRIPTION_CONFIG } from '../../config/constants';
import { AppError } from '../../shared/errors/AppError';
import { NotFoundError } from '../../shared/errors/NotFoundError';
import { ValidationError } from '../../shared/errors/ValidationError';
import {
  AuthTx,
  getLockedAuthManagedUser,
  reconcileAuthAccessMode,
  reconcilePremiumAccessTx
} from '../../shared/auth/accessPolicy';
import {
  buildRouteKey,
  IdempotencyContext,
  idempotencyService
} from '../../shared/idempotency/idempotency';
import { getGlobalMetricsRegistry } from '../../shared/metrics/global';
import {
  CancelSubscriptionInput,
  CancelSubscriptionResponse,
  InitiateSubscriptionInput,
  InitiateSubscriptionResponse,
  SubscriptionPaymentState,
  SubscriptionRequestContext,
  SubscriptionSnapshot,
  SubscriptionStatusResponse,
  VerifySubscriptionInput,
  VerifySubscriptionResponse
} from './subscriptions.types';
import {
  PaymentProviderVerificationResult,
  SubscriptionPaymentProvider
} from './payment-provider';
import { getSubscriptionPaymentProvider } from './payment-provider-registry';

type SubscriptionRecord = Prisma.SubscriptionGetPayload<{
  select: {
    id: true;
    planType: true;
    amountPaid: true;
    paymentReference: true;
    status: true;
    startDate: true;
    endDate: true;
    autoRenew: true;
  };
}>;

type PaymentVerificationSource = 'CLIENT_VERIFY' | 'PROVIDER_WEBHOOK' | 'SUBSCRIPTION_EXPIRY_JOB';

interface NormalizedVerifiedPayment {
  provider: PaymentProvider;
  userId: number;
  reference: string;
  paymentStatus: SubscriptionPaymentState;
  amountKobo: number;
  currency: string;
  channel: string | null;
  gatewayResponse: string | null;
  customerEmail: string | null;
  customerCode: string | null;
  authorizationCode: string | null;
  authorizationReusable: boolean;
  authorizationSignature: string | null;
  requestedAutoRenew: boolean;
  paidAt: Date | null;
  providerPayload: Prisma.InputJsonValue;
}

interface PaymentMetadata extends Record<string, unknown> {
  userId: number;
  planType: string;
  requestedAutoRenew: boolean;
}

function requireIdempotencyKey(idempotencyKey: string | undefined): string {
  const normalized = idempotencyKey?.trim();
  if (!normalized) {
    throw new AppError(
      'This action requires an Idempotency-Key header for safe retries.',
      400,
      'IDEMPOTENCY_KEY_REQUIRED'
    );
  }

  return normalized;
}

function addMonthsClamped(baseDate: Date, months: number): Date {
  const baseUtc = new Date(baseDate);
  const originalDay = baseUtc.getUTCDate();
  const candidate = new Date(Date.UTC(
    baseUtc.getUTCFullYear(),
    baseUtc.getUTCMonth() + months,
    1,
    baseUtc.getUTCHours(),
    baseUtc.getUTCMinutes(),
    baseUtc.getUTCSeconds(),
    baseUtc.getUTCMilliseconds()
  ));

  candidate.setUTCMonth(candidate.getUTCMonth() + 1, 0);
  const lastDay = candidate.getUTCDate();
  candidate.setUTCDate(Math.min(originalDay, lastDay));

  return candidate;
}

function amountDecimalFromKobo(amountKobo: number): Prisma.Decimal {
  return new Prisma.Decimal((amountKobo / 100).toFixed(2));
}

function amountNumberFromDecimal(value: Prisma.Decimal | Prisma.Decimal.Value): number {
  return Number(value);
}

function daysRemaining(endDate: Date): number {
  const diffMs = endDate.getTime() - Date.now();
  if (diffMs <= 0) return 0;
  return Math.ceil(diffMs / (24 * 60 * 60 * 1000));
}

function generatePaymentReference(userId: number): string {
  const suffix = randomBytes(6).toString('hex');
  return `SBSUB-${userId}-${Date.now()}-${suffix}`.slice(0, 100);
}

function normalizeRequestedAutoRenew(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') return value.trim().toLowerCase() === 'true';
  return false;
}

function parseMetadata(value: unknown): PaymentMetadata | null {
  const raw = typeof value === 'string'
    ? (() => {
        try {
          return JSON.parse(value);
        } catch {
          return null;
        }
      })()
    : value;

  if (!raw || typeof raw !== 'object') return null;

  const candidate = raw as Record<string, unknown>;
  const userId = Number(candidate.userId);
  const planType = typeof candidate.planType === 'string' ? candidate.planType.trim() : '';

  if (!Number.isInteger(userId) || userId <= 0 || !planType) {
    return null;
  }

  return {
    userId,
    planType,
    requestedAutoRenew: normalizeRequestedAutoRenew(candidate.requestedAutoRenew)
  };
}

export class SubscriptionService {
  constructor(
    private readonly app?: FastifyInstance,
    private readonly paymentProvider: SubscriptionPaymentProvider = getSubscriptionPaymentProvider()
  ) {}

  getPaymentProviderDisplayName(): string {
    return this.paymentProvider.displayName;
  }

  getWebhookHeadersSchema() {
    return this.paymentProvider.webhookHeadersSchema;
  }

  extractWebhookSignature(headers: Record<string, unknown>): string | undefined {
    return this.paymentProvider.extractWebhookSignature(headers);
  }

  private metricCounter(name: string, labels?: Record<string, string | number | boolean>): void {
    getGlobalMetricsRegistry()?.incrementCounter(name, 1, labels);
  }

  private metricHistogram(name: string, value: number, labels?: Record<string, string | number | boolean>): void {
    getGlobalMetricsRegistry()?.observeHistogram(name, value, labels);
  }

  private buildIdempotencyContext(
    userId: number,
    routeKey: string,
    idempotencyKey: string | undefined,
    payload: unknown
  ): IdempotencyContext {
    return {
      userId,
      routeKey,
      idempotencyKey: requireIdempotencyKey(idempotencyKey),
      payload
    };
  }

  private async writeAuditLog(
    userId: number,
    action: 'SUBSCRIPTION_UPGRADED' | 'SUBSCRIPTION_CANCELLED' | 'SUBSCRIPTION_EXPIRED',
    metadata: Prisma.InputJsonValue
  ): Promise<void> {
    try {
      await prisma.auditLog.create({
        data: {
          userId,
          action,
          metadata
        }
      });
    } catch (error) {
      this.app?.log.error({ error, userId, action }, 'Subscription audit log write failed');
    }
  }

  private buildSubscriptionSnapshot(subscription: SubscriptionRecord | null): SubscriptionSnapshot | null {
    if (!subscription) return null;

    return {
      status: subscription.status,
      planType: subscription.planType,
      amountPaidNaira: amountNumberFromDecimal(subscription.amountPaid),
      currency: SUBSCRIPTION_CONFIG.CURRENCY,
      autoRenew: subscription.autoRenew,
      startDate: subscription.startDate.toISOString(),
      endDate: subscription.endDate.toISOString(),
      daysRemaining: daysRemaining(subscription.endDate),
      lastPaymentReference: subscription.paymentReference
    };
  }

  private async loadSubscriptionSnapshot(userId: number): Promise<SubscriptionSnapshot | null> {
    const subscription = await prisma.subscription.findUnique({
      where: { userId },
      select: {
        id: true,
        planType: true,
        amountPaid: true,
        paymentReference: true,
        status: true,
        startDate: true,
        endDate: true,
        autoRenew: true
      }
    });

    return this.buildSubscriptionSnapshot(subscription);
  }

  private buildPaymentMetadata(userId: number, autoRenew: boolean): PaymentMetadata {
    return {
      userId,
      planType: SUBSCRIPTION_CONFIG.PLAN_TYPE,
      requestedAutoRenew: autoRenew
    };
  }

  private normalizeVerifiedPayment(
    verified: PaymentProviderVerificationResult,
    expectedUserId?: number
  ): NormalizedVerifiedPayment {
    const reference = typeof verified.reference === 'string' ? verified.reference.trim() : '';
    if (!reference) {
      throw new AppError(
        'The payment verification response did not include a usable reference.',
        502,
        'SUBSCRIPTION_PROVIDER_INVALID_RESPONSE'
      );
    }

    const metadata = parseMetadata(verified.metadata);
    if (!metadata || metadata.planType !== SUBSCRIPTION_CONFIG.PLAN_TYPE) {
      throw new AppError(
        'This payment does not belong to the StudyBond premium plan.',
        409,
        'SUBSCRIPTION_PLAN_MISMATCH'
      );
    }

    if (expectedUserId && metadata.userId !== expectedUserId) {
      throw new AppError(
        'This payment reference does not belong to the signed-in account.',
        403,
        'SUBSCRIPTION_REFERENCE_OWNERSHIP_MISMATCH'
      );
    }

    if (verified.currency !== SUBSCRIPTION_CONFIG.CURRENCY) {
      throw new AppError(
        'The payment currency does not match the configured subscription currency.',
        409,
        'SUBSCRIPTION_CURRENCY_MISMATCH'
      );
    }

    if (verified.amountMinor !== SUBSCRIPTION_CONFIG.PRICE_KOBO) {
      throw new AppError(
        'The payment amount does not match the configured premium price.',
        409,
        'SUBSCRIPTION_AMOUNT_MISMATCH'
      );
    }

    return {
      provider: verified.provider,
      userId: metadata.userId,
      reference,
      paymentStatus: verified.paymentStatus,
      amountKobo: verified.amountMinor,
      currency: verified.currency,
      channel: verified.channel,
      gatewayResponse: verified.gatewayResponse,
      customerEmail: verified.customerEmail,
      customerCode: verified.customerCode,
      authorizationCode: verified.authorizationCode,
      authorizationReusable: verified.authorizationReusable,
      authorizationSignature: verified.authorizationSignature,
      requestedAutoRenew: metadata.requestedAutoRenew,
      paidAt: verified.paidAt,
      providerPayload: verified.providerPayload
    };
  }

  private async upsertPendingPayment(
    userId: number,
    reference: string,
    accessCode: string,
    autoRenew: boolean
  ): Promise<void> {
    await prisma.subscriptionPayment.upsert({
      where: { reference },
      update: {
        provider: this.paymentProvider.provider,
        accessCode,
        requestedAutoRenew: autoRenew,
        status: SubscriptionPaymentStatus.PENDING,
        amountPaid: amountDecimalFromKobo(SUBSCRIPTION_CONFIG.PRICE_KOBO),
        currency: SUBSCRIPTION_CONFIG.CURRENCY
      },
      create: {
        userId,
        provider: this.paymentProvider.provider,
        reference,
        accessCode,
        requestedAutoRenew: autoRenew,
        amountPaid: amountDecimalFromKobo(SUBSCRIPTION_CONFIG.PRICE_KOBO),
        currency: SUBSCRIPTION_CONFIG.CURRENCY,
        status: SubscriptionPaymentStatus.PENDING
      }
    });
  }

  private async persistUnsuccessfulPayment(payment: NormalizedVerifiedPayment): Promise<void> {
    await prisma.subscriptionPayment.upsert({
      where: { reference: payment.reference },
      update: {
        userId: payment.userId,
        provider: payment.provider,
        status: payment.paymentStatus as SubscriptionPaymentStatus,
        amountPaid: amountDecimalFromKobo(payment.amountKobo),
        currency: payment.currency,
        channel: payment.channel,
        gatewayResponse: payment.gatewayResponse,
        requestedAutoRenew: payment.requestedAutoRenew,
        customerCode: payment.customerCode,
        authorizationCode: payment.authorizationCode,
        authorizationSignature: payment.authorizationSignature,
        providerPayload: payment.providerPayload,
        paidAt: payment.paidAt
      },
      create: {
        userId: payment.userId,
        provider: payment.provider,
        reference: payment.reference,
        status: payment.paymentStatus as SubscriptionPaymentStatus,
        amountPaid: amountDecimalFromKobo(payment.amountKobo),
        currency: payment.currency,
        channel: payment.channel,
        gatewayResponse: payment.gatewayResponse,
        requestedAutoRenew: payment.requestedAutoRenew,
        customerCode: payment.customerCode,
        authorizationCode: payment.authorizationCode,
        authorizationSignature: payment.authorizationSignature,
        providerPayload: payment.providerPayload,
        paidAt: payment.paidAt
      }
    });
  }

  private buildVerificationMessage(paymentStatus: SubscriptionPaymentState): string {
    switch (paymentStatus) {
      case 'SUCCESS':
        return 'Premium access is now active on your account.';
      case 'FAILED':
        return 'The payment did not go through, so premium access was not activated.';
      case 'ABANDONED':
        return 'The checkout was abandoned before payment completed.';
      case 'REVERSED':
        return 'This payment was reversed, so premium access was not activated.';
      default:
        return 'Your payment is still processing. Wait a moment, then verify again.';
    }
  }

  private async applySuccessfulPaymentTx(
    tx: AuthTx,
    payment: NormalizedVerifiedPayment,
    source: PaymentVerificationSource
  ): Promise<VerifySubscriptionResponse> {
    let existingPayment = await tx.subscriptionPayment.findUnique({
      where: { reference: payment.reference }
    });

    if (!existingPayment) {
      try {
        existingPayment = await tx.subscriptionPayment.create({
          data: {
            userId: payment.userId,
            provider: payment.provider,
            reference: payment.reference,
            status: SubscriptionPaymentStatus.PENDING,
            amountPaid: amountDecimalFromKobo(payment.amountKobo),
            currency: payment.currency,
            requestedAutoRenew: payment.requestedAutoRenew
          }
        });
      } catch (error: any) {
        if (error?.code === 'P2002') {
          existingPayment = await tx.subscriptionPayment.findUnique({
            where: { reference: payment.reference }
          });
        } else {
          throw error;
        }
      }
    }

    if (!existingPayment) {
      throw new AppError(
        'We could not lock this payment record for activation.',
        500,
        'SUBSCRIPTION_PAYMENT_PERSISTENCE_FAILED'
      );
    }

    if (existingPayment.userId !== payment.userId) {
      throw new AppError(
        'This payment reference is already attached to another account.',
        409,
        'SUBSCRIPTION_REFERENCE_OWNERSHIP_MISMATCH'
      );
    }

    if (existingPayment.status === SubscriptionPaymentStatus.SUCCESS) {
      const snapshot = await tx.subscription.findUnique({
        where: { userId: payment.userId },
        select: {
          id: true,
          planType: true,
          amountPaid: true,
          paymentReference: true,
          status: true,
          startDate: true,
          endDate: true,
          autoRenew: true
        }
      });

      return {
        activated: true,
        paymentStatus: 'SUCCESS',
        message: 'Premium access is already active for this payment reference.',
        subscription: this.buildSubscriptionSnapshot(snapshot)
      };
    }

    const claimed = await tx.subscriptionPayment.updateMany({
      where: {
        reference: payment.reference,
        status: {
          not: SubscriptionPaymentStatus.SUCCESS
        }
      },
      data: {
        status: SubscriptionPaymentStatus.SUCCESS,
        amountPaid: amountDecimalFromKobo(payment.amountKobo),
        currency: payment.currency,
        channel: payment.channel,
        gatewayResponse: payment.gatewayResponse,
        requestedAutoRenew: payment.requestedAutoRenew,
        customerCode: payment.customerCode,
        authorizationCode: payment.authorizationCode,
        authorizationSignature: payment.authorizationSignature,
        providerPayload: payment.providerPayload,
        paidAt: payment.paidAt
      }
    });

    if (claimed.count !== 1) {
      const snapshot = await tx.subscription.findUnique({
        where: { userId: payment.userId },
        select: {
          id: true,
          planType: true,
          amountPaid: true,
          paymentReference: true,
          status: true,
          startDate: true,
          endDate: true,
          autoRenew: true
        }
      });

      return {
        activated: true,
        paymentStatus: 'SUCCESS',
        message: 'Premium access is already active for this payment reference.',
        subscription: this.buildSubscriptionSnapshot(snapshot)
      };
    }

    const lockedUser = await getLockedAuthManagedUser(tx, payment.userId);
    if (!lockedUser) {
      throw new NotFoundError('User not found for this payment reference.');
    }
    const wasPremiumBefore = lockedUser.isPremium;

    if (payment.customerEmail && payment.customerEmail.toLowerCase() !== lockedUser.email.toLowerCase()) {
      throw new AppError(
        'The payment email does not match the signed-in StudyBond account.',
        409,
        'SUBSCRIPTION_EMAIL_MISMATCH'
      );
    }

    const existingSubscription = await tx.subscription.findUnique({
      where: { userId: payment.userId }
    });

    if (existingSubscription) {
      await tx.$queryRaw`SELECT id FROM "Subscription" WHERE id = ${existingSubscription.id} FOR UPDATE`;
    }

    const activationMoment = payment.paidAt && Number.isFinite(payment.paidAt.getTime())
      ? payment.paidAt
      : new Date();
    const effectiveStart = existingSubscription &&
      existingSubscription.status === SubscriptionStatus.ACTIVE &&
      existingSubscription.endDate > activationMoment
      ? existingSubscription.endDate
      : activationMoment;
    const nextEndDate = addMonthsClamped(effectiveStart, SUBSCRIPTION_CONFIG.DURATION_MONTHS);
    const nextStartDate = existingSubscription &&
      existingSubscription.status === SubscriptionStatus.ACTIVE &&
      existingSubscription.endDate > activationMoment
      ? existingSubscription.startDate
      : activationMoment;

    const subscription = await tx.subscription.upsert({
      where: { userId: payment.userId },
      update: {
        provider: payment.provider,
        planType: SUBSCRIPTION_CONFIG.PLAN_TYPE,
        amountPaid: amountDecimalFromKobo(payment.amountKobo),
        paymentReference: payment.reference,
        status: SubscriptionStatus.ACTIVE,
        startDate: nextStartDate,
        endDate: nextEndDate,
        autoRenew: payment.requestedAutoRenew,
        cancelledAt: null,
        customerCode: payment.customerCode,
        authorizationCode: payment.authorizationCode,
        authorizationSignature: payment.authorizationSignature,
        authorizationReusable: payment.authorizationReusable,
        lastPaymentVerifiedAt: new Date(),
        renewalFailureCount: 0
      },
      create: {
        userId: payment.userId,
        provider: payment.provider,
        planType: SUBSCRIPTION_CONFIG.PLAN_TYPE,
        amountPaid: amountDecimalFromKobo(payment.amountKobo),
        paymentReference: payment.reference,
        status: SubscriptionStatus.ACTIVE,
        startDate: nextStartDate,
        endDate: nextEndDate,
        autoRenew: payment.requestedAutoRenew,
        customerCode: payment.customerCode,
        authorizationCode: payment.authorizationCode,
        authorizationSignature: payment.authorizationSignature,
        authorizationReusable: payment.authorizationReusable,
        lastPaymentVerifiedAt: new Date()
      }
    });

    await tx.subscriptionPayment.update({
      where: { reference: payment.reference },
      data: {
        subscriptionId: subscription.id
      }
    });

    const premiumUser = await reconcilePremiumAccessTx(tx, payment.userId);
    if (!premiumUser) {
      throw new NotFoundError('User not found for this payment reference.');
    }

    await tx.auditLog.create({
      data: {
        userId: payment.userId,
        action: 'SUBSCRIPTION_UPGRADED',
        metadata: {
          paymentReference: payment.reference,
          source,
          amountKobo: payment.amountKobo,
          currency: payment.currency,
          autoRenew: payment.requestedAutoRenew,
          planType: SUBSCRIPTION_CONFIG.PLAN_TYPE,
          endDate: nextEndDate.toISOString()
        }
      }
    });

    return {
      activated: true,
      paymentStatus: 'SUCCESS',
      message: wasPremiumBefore
        ? 'Premium access is active and your subscription period has been extended.'
        : 'Premium access is now active. Please sign in again so your first premium device can be registered safely.',
      subscription: this.buildSubscriptionSnapshot({
        id: subscription.id,
        planType: subscription.planType,
        amountPaid: subscription.amountPaid,
        paymentReference: subscription.paymentReference,
        status: subscription.status,
        startDate: subscription.startDate,
        endDate: subscription.endDate,
        autoRenew: subscription.autoRenew
      })
    };
  }

  private async processVerifiedPayment(
    verified: PaymentProviderVerificationResult,
    source: PaymentVerificationSource,
    expectedUserId?: number
  ): Promise<VerifySubscriptionResponse> {
    const startedAt = Date.now();
    const normalizedPayment = this.normalizeVerifiedPayment(verified, expectedUserId);

    if (normalizedPayment.paymentStatus !== 'SUCCESS') {
      await this.persistUnsuccessfulPayment(normalizedPayment);
      this.metricCounter('subscription_verification_total', {
        provider: normalizedPayment.provider,
        source,
        paymentStatus: normalizedPayment.paymentStatus,
        activated: false
      });

      return {
        activated: false,
        paymentStatus: normalizedPayment.paymentStatus,
        message: this.buildVerificationMessage(normalizedPayment.paymentStatus),
        subscription: await this.loadSubscriptionSnapshot(normalizedPayment.userId)
      };
    }

    const result = await prisma.$transaction(
      async (tx: AuthTx) => this.applySuccessfulPaymentTx(tx, normalizedPayment, source),
      {
        maxWait: AUTH_CONFIG.TX_MAX_WAIT_MS,
        timeout: AUTH_CONFIG.TX_TIMEOUT_MS
      }
    );

    this.metricCounter('subscription_verification_total', {
      source,
      provider: normalizedPayment.provider,
      paymentStatus: normalizedPayment.paymentStatus,
      activated: result.activated
    });
    this.metricHistogram('subscription_verification_duration_ms', Date.now() - startedAt, {
      source,
      provider: normalizedPayment.provider
    });

    return result;
  }

  async getStatus(userId: number): Promise<SubscriptionStatusResponse> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        isPremium: true,
        subscriptionEndDate: true
      }
    });

    if (!user) {
      throw new NotFoundError('User not found.');
    }

    if (user.isPremium && user.subscriptionEndDate && user.subscriptionEndDate <= new Date()) {
      await reconcileAuthAccessMode(user.id);
    }

    const refreshedUser = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        isPremium: true
      }
    });

    return {
      isPremium: Boolean(refreshedUser?.isPremium),
      planType: SUBSCRIPTION_CONFIG.PLAN_TYPE,
      priceNaira: SUBSCRIPTION_CONFIG.PRICE_NAIRA,
      currency: SUBSCRIPTION_CONFIG.CURRENCY,
      durationMonths: SUBSCRIPTION_CONFIG.DURATION_MONTHS,
      currentSubscription: await this.loadSubscriptionSnapshot(userId)
    };
  }

  async initiateSubscription(
    userId: number,
    input: InitiateSubscriptionInput,
    context: SubscriptionRequestContext = {}
  ): Promise<InitiateSubscriptionResponse> {
    const routeKey = buildRouteKey('POST', '/api/subscriptions/initiate');
    const idempotency = this.buildIdempotencyContext(userId, routeKey, context.idempotencyKey, input);

    return idempotencyService.execute(idempotency, async () => {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          email: true,
          isVerified: true
        }
      });

      if (!user) {
        throw new NotFoundError('User not found.');
      }

      if (!user.isVerified) {
        throw new ValidationError('Please verify your email before starting a premium payment.');
      }

      const autoRenew = input.autoRenew ?? false;
      const reference = generatePaymentReference(userId);
      const initialized = await this.paymentProvider.initializeTransaction({
        email: user.email,
        amountMinor: SUBSCRIPTION_CONFIG.PRICE_KOBO,
        reference,
        callbackUrl: SUBSCRIPTION_CONFIG.CALLBACK_URL,
        currency: SUBSCRIPTION_CONFIG.CURRENCY,
        metadata: this.buildPaymentMetadata(userId, autoRenew)
      });

      await this.upsertPendingPayment(userId, initialized.reference, initialized.accessCode, autoRenew);

      this.metricCounter('subscription_initiated_total', {
        autoRenew,
        provider: initialized.provider
      });

      return {
        reference: initialized.reference,
        checkoutUrl: initialized.checkoutUrl,
        accessCode: initialized.accessCode,
        amountNaira: SUBSCRIPTION_CONFIG.PRICE_NAIRA,
        currency: SUBSCRIPTION_CONFIG.CURRENCY,
        planType: SUBSCRIPTION_CONFIG.PLAN_TYPE,
        durationMonths: SUBSCRIPTION_CONFIG.DURATION_MONTHS,
        autoRenew,
        message: 'Payment link created. Complete checkout to activate premium access.'
      };
    });
  }

  async verifySubscription(
    userId: number,
    input: VerifySubscriptionInput,
    context: SubscriptionRequestContext = {}
  ): Promise<VerifySubscriptionResponse> {
    const routeKey = buildRouteKey('POST', '/api/subscriptions/verify');
    const idempotency = this.buildIdempotencyContext(userId, routeKey, context.idempotencyKey, input);

    return idempotencyService.execute(idempotency, async () => {
      const verified = await this.paymentProvider.verifyTransaction(input.reference);
      return this.processVerifiedPayment(verified, 'CLIENT_VERIFY', userId);
    });
  }

  async cancelSubscription(
    userId: number,
    input: CancelSubscriptionInput,
    context: SubscriptionRequestContext = {}
  ): Promise<CancelSubscriptionResponse> {
    const routeKey = buildRouteKey('POST', '/api/subscriptions/cancel');
    const idempotency = this.buildIdempotencyContext(userId, routeKey, context.idempotencyKey, input);

    return idempotencyService.execute(idempotency, async () => {
      const subscription = await prisma.subscription.findUnique({
        where: { userId },
        select: {
          id: true,
          planType: true,
          amountPaid: true,
          paymentReference: true,
          status: true,
          startDate: true,
          endDate: true,
          autoRenew: true
        }
      });

      if (!subscription) {
        throw new NotFoundError('There is no premium subscription to update for this account.');
      }

      const updated = await prisma.subscription.update({
        where: { userId },
        data: {
          autoRenew: false,
          cancelledAt: new Date()
        },
        select: {
          id: true,
          planType: true,
          amountPaid: true,
          paymentReference: true,
          status: true,
          startDate: true,
          endDate: true,
          autoRenew: true
        }
      });

      await this.writeAuditLog(userId, 'SUBSCRIPTION_CANCELLED', {
        reason: input.reason || 'user_requested',
        endDate: updated.endDate.toISOString()
      });

      this.metricCounter('subscription_cancel_total');

      return {
        autoRenew: updated.autoRenew,
        message: 'Auto-renew has been turned off. Your premium access stays active until the current period ends.',
        subscription: this.buildSubscriptionSnapshot(updated)
      };
    });
  }

  async handleWebhook(signature: string | undefined, rawBody: string, payload: unknown): Promise<void> {
    this.paymentProvider.verifyWebhookSignature(rawBody, signature);

    const parsedPayload = payload as { event?: string };
    if (parsedPayload.event !== 'charge.success') {
      this.metricCounter('subscription_webhook_total', {
        provider: this.paymentProvider.provider,
        event: parsedPayload.event || 'unknown',
        handled: false
      });
      return;
    }

    const reference = this.paymentProvider.extractWebhookReference(payload);
    if (!reference) {
      throw new AppError(
        'The payment callback did not include a transaction reference.',
        400,
        'SUBSCRIPTION_WEBHOOK_REFERENCE_MISSING'
      );
    }

    const verified = await this.paymentProvider.verifyTransaction(reference);
    await this.processVerifiedPayment(verified, 'PROVIDER_WEBHOOK');

    this.metricCounter('subscription_webhook_total', {
      provider: this.paymentProvider.provider,
      event: parsedPayload.event,
      handled: true
    });
  }

  async expireDueSubscriptions(limit = SUBSCRIPTION_CONFIG.EXPIRY_BATCH_SIZE): Promise<number> {
    const dueSubscriptions = await prisma.subscription.findMany({
      where: {
        status: SubscriptionStatus.ACTIVE,
        endDate: { lte: new Date() }
      },
      orderBy: { endDate: 'asc' },
      take: limit,
      select: {
        userId: true,
        endDate: true
      }
    });

    let expiredUsers = 0;

    for (const due of dueSubscriptions) {
      const changed = await prisma.$transaction(
        async (tx: AuthTx) => {
          const subscription = await tx.subscription.findUnique({
            where: { userId: due.userId }
          });

          if (!subscription || subscription.status !== SubscriptionStatus.ACTIVE || subscription.endDate > new Date()) {
            return false;
          }

          await tx.subscription.update({
            where: { userId: due.userId },
            data: {
              status: SubscriptionStatus.EXPIRED
            }
          });

          const reconciledUser = await reconcilePremiumAccessTx(tx, due.userId);
          if (!reconciledUser) return false;

          await tx.auditLog.create({
            data: {
              userId: due.userId,
              action: 'SUBSCRIPTION_EXPIRED',
              metadata: {
                endDate: subscription.endDate.toISOString()
              }
            }
          });

          return true;
        },
        {
          maxWait: AUTH_CONFIG.TX_MAX_WAIT_MS,
          timeout: AUTH_CONFIG.TX_TIMEOUT_MS
        }
      );

      if (changed) {
        expiredUsers += 1;
      }
    }

    if (expiredUsers > 0) {
      this.metricCounter('subscription_expired_total', { expiredUsers });
    }

    return expiredUsers;
  }
}
