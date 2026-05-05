import { AuditAction, EmailType, Prisma, UserDevice } from '@prisma/client';
import { prisma } from '../../config/database';
import {
  AuthRequestContext,
  AuthOtpChallengeResponse,
  AuthMessageResponse,
  AuthResponse,
  AuthSuccessResponse,
  AuthVerificationResendResponse,
  ForgotPasswordInput,
  LoginInput,
  RegisterInput,
  ResendVerificationOtpInput,
  ResetPasswordInput,
  VerifyOtpInput
} from './auth.types';
import {
  hashPassword,
  verifyPassword,
  generateTokens,
  generateOTP,
  hashOtp,
  verifyOtpHash,
  verifyRefreshToken,
} from './auth.utils';
import { AuthError } from '../../shared/errors/AuthError';
import { AUTH_CONFIG } from '../../config/constants';
import {
  createEphemeralSessionDeviceKey,
  resolveDeviceFingerprint,
  resolveStoredDeviceBindingHash,
  ResolvedDeviceFingerprint
} from '../../shared/utils/deviceFingerprint';
import {
  AuthManagedUser,
  AuthTx,
  authManagedUserSelect,
  getLockedAuthManagedUser,
  reconcileAuthAccessMode,
  reconcilePremiumAccessTx
} from '../../shared/auth/accessPolicy';
import { assertPasswordChangeAllowed } from '../../shared/auth/passwordPolicy';
import { transactionalEmailService } from '../../shared/email/email.service';
import {
  buildEmailVerificationOtpTemplate,
  buildPasswordResetOtpTemplate,
  buildPremiumDeviceOtpTemplate
} from '../../shared/email/email.templates';
import { institutionContextService } from '../../shared/institutions/context';
import { decideRefreshTokenRotation } from '../../shared/utils/refreshTokenRotation';

type SessionUser = Pick<AuthManagedUser, 'id' | 'email' | 'fullName' | 'isPremium' | 'role'>;
const PASSWORD_RESET_REQUEST_MESSAGE =
  'If an account exists for that email, we sent a 6-digit code you can use to reset your password.';
const PASSWORD_RESET_RESEND_MESSAGE =
  'If that password reset request is still active, we sent a fresh 6-digit code to your email.';
const EMAIL_VERIFICATION_RESEND_MESSAGE =
  'If this email is still waiting for verification, we sent a fresh 6-digit code to your email.';

const passwordResetManagedUserSelect = {
  id: true,
  email: true,
  fullName: true,
  isVerified: true,
  otpRequestCount: true,
  lastOtpRequestDate: true,
  passwordResetAttemptCount: true,
  passwordResetToken: true,
  passwordResetExpires: true
} satisfies Prisma.UserSelect;

type PasswordResetManagedUser = Prisma.UserGetPayload<{
  select: typeof passwordResetManagedUserSelect;
}>;

export class AuthService {
  private runTransaction<T>(operation: (tx: AuthTx) => Promise<T>): Promise<T> {
    return prisma.$transaction(operation, {
      maxWait: AUTH_CONFIG.TX_MAX_WAIT_MS,
      timeout: AUTH_CONFIG.TX_TIMEOUT_MS
    });
  }

  private throwIfBanned(user: { isBanned: boolean; bannedReason: string | null }) {
    if (!user.isBanned) return;
    throw new AuthError(
      user.bannedReason
        ? `Account suspended: ${user.bannedReason}`
        : 'Account suspended. Please contact support.',
      403,
      'ACCOUNT_BANNED'
    );
  }

  private buildAuthSuccessResponse(
    user: SessionUser,
    sessionId: string,
    deviceId: string,
    tokenVersion: number,
    message?: string
  ): AuthSuccessResponse {
    const tokens = generateTokens(
      {
        id: user.id,
        email: user.email,
        role: user.role
      },
      sessionId,
      deviceId,
      tokenVersion
    );

    return {
      user: {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        isPremium: user.isPremium,
        role: user.role
      },
      ...tokens,
      requiresOTP: false,
      message
    };
  }

  private isPrivilegedDevicePolicyExempt(user: Pick<AuthManagedUser, 'role'>): boolean {
    return user.role === 'ADMIN' || user.role === 'SUPERADMIN';
  }

  private async writeAuditLog(
    userId: number | null,
    action: AuditAction,
    options: {
      deviceId?: string;
      ipAddress?: string;
      userAgent?: string;
      metadata?: Prisma.InputJsonValue;
    } = {}
  ): Promise<void> {
    try {
      await prisma.auditLog.create({
        data: {
          userId,
          action,
          deviceId: options.deviceId,
          ipAddress: options.ipAddress,
          userAgent: options.userAgent,
          metadata: options.metadata
        }
      });
    } catch (error) {
      console.error('[AUTH_AUDIT_LOG_FAILURE]', { userId, action, error });
    }
  }

  private async sendEmailVerificationOtp(
    user: { id: number; email: string; fullName: string },
    otp: string,
    context: AuthRequestContext
  ) {
    const template = buildEmailVerificationOtpTemplate(user.fullName, otp);

    return transactionalEmailService.send({
      userId: user.id,
      emailType: EmailType.VERIFICATION_OTP,
      to: {
        email: user.email,
        name: user.fullName
      },
      subject: template.subject,
      html: template.html,
      text: template.text,
      isCritical: true,
      debugPreviewCode: otp,
      metadata: {
        reason: 'email_verification_registration',
        ipAddress: context.ipAddress || null
      }
    });
  }

  private async sendPremiumDeviceOtp(
    user: { id: number; email: string; fullName: string },
    otp: string,
    deviceName: string | undefined,
    context: AuthRequestContext
  ) {
    const template = buildPremiumDeviceOtpTemplate(user.fullName, otp, deviceName);

    return transactionalEmailService.send({
      userId: user.id,
      emailType: EmailType.DEVICE_VERIFICATION_OTP,
      to: {
        email: user.email,
        name: user.fullName
      },
      subject: template.subject,
      html: template.html,
      text: template.text,
      isCritical: true,
      debugPreviewCode: otp,
      metadata: {
        reason: 'premium_device_registration',
        deviceName: deviceName || null,
        ipAddress: context.ipAddress || null
      }
    });
  }

  private async sendPasswordResetOtp(
    user: { id: number; email: string; fullName: string },
    otp: string,
    context: AuthRequestContext
  ) {
    const template = buildPasswordResetOtpTemplate(user.fullName, otp);

    return transactionalEmailService.send({
      userId: user.id,
      emailType: EmailType.PASSWORD_RESET_OTP,
      to: {
        email: user.email,
        name: user.fullName
      },
      subject: template.subject,
      html: template.html,
      text: template.text,
      isCritical: true,
      debugPreviewCode: otp,
      metadata: {
        reason: 'password_reset',
        ipAddress: context.ipAddress || null
      }
    });
  }

  private getOtpIssuedAt(expiresAt: Date | null, expiryMs: number): Date | null {
    if (!expiresAt) {
      return null;
    }

    return new Date(expiresAt.getTime() - expiryMs);
  }

  private getOtpResendAvailableAt(
    expiresAt: Date | null,
    expiryMs: number,
    cooldownMs: number
  ): Date | null {
    const issuedAt = this.getOtpIssuedAt(expiresAt, expiryMs);
    if (!issuedAt) {
      return null;
    }

    return new Date(issuedAt.getTime() + cooldownMs);
  }

  private isOtpResendCooldownActive(
    expiresAt: Date | null,
    expiryMs: number,
    cooldownMs: number,
    now = new Date()
  ): boolean {
    const resendAvailableAt = this.getOtpResendAvailableAt(expiresAt, expiryMs, cooldownMs);
    if (!resendAvailableAt) {
      return false;
    }

    return resendAvailableAt.getTime() > now.getTime();
  }

  private buildOtpChallengeResponse(
    verificationType: AuthOtpChallengeResponse['verificationType'],
    message: string,
    options: {
      otpExpiresAt?: Date | null;
      resendAvailableAt?: Date | null;
    } = {}
  ): AuthOtpChallengeResponse {
    return {
      requiresOTP: true,
      verificationType,
      message,
      ...(options.otpExpiresAt ? { otpExpiresAt: options.otpExpiresAt.toISOString() } : {}),
      ...(options.resendAvailableAt ? { resendAvailableAt: options.resendAvailableAt.toISOString() } : {})
    };
  }

  private buildEmailVerificationChallenge(
    message: string,
    tokenExpiresAt: Date | null
  ): AuthOtpChallengeResponse {
    return this.buildOtpChallengeResponse('EMAIL_VERIFICATION', message, {
      otpExpiresAt: tokenExpiresAt,
      resendAvailableAt: this.getOtpResendAvailableAt(
        tokenExpiresAt,
        AUTH_CONFIG.OTP_EXPIRY_MS,
        AUTH_CONFIG.EMAIL_VERIFICATION_RESEND_COOLDOWN_MS
      )
    });
  }

  private buildVerificationResendResponse(
    message: string,
    tokenExpiresAt: Date | null
  ): AuthVerificationResendResponse {
    const resendAvailableAt = this.getOtpResendAvailableAt(
      tokenExpiresAt,
      AUTH_CONFIG.OTP_EXPIRY_MS,
      AUTH_CONFIG.EMAIL_VERIFICATION_RESEND_COOLDOWN_MS
    );

    return {
      message,
      ...(tokenExpiresAt ? { otpExpiresAt: tokenExpiresAt.toISOString() } : {}),
      ...(resendAvailableAt ? { resendAvailableAt: resendAvailableAt.toISOString() } : {})
    };
  }

  private async consumeOtpQuotaTx(
    tx: AuthTx,
    user: Pick<AuthManagedUser, 'id' | 'otpRequestCount' | 'lastOtpRequestDate'>
  ): Promise<void> {
    const today = new Date().toISOString().split('T')[0];
    const lastDate = user.lastOtpRequestDate
      ? user.lastOtpRequestDate.toISOString().split('T')[0]
      : null;

    if (lastDate !== today && (user.otpRequestCount > 0 || user.lastOtpRequestDate)) {
      await tx.user.update({
        where: { id: user.id },
        data: {
          otpRequestCount: 0,
          lastOtpRequestDate: null
        }
      });

      user.otpRequestCount = 0;
      user.lastOtpRequestDate = null;
    }

    if (user.otpRequestCount >= AUTH_CONFIG.MAX_OTP_REQUESTS_DAILY) {
      throw new AuthError(
        'Maximum OTP requests reached for today. Try again tomorrow.',
        429,
        'OTP_LIMIT_EXCEEDED'
      );
    }

    await tx.user.update({
      where: { id: user.id },
      data: {
        otpRequestCount: { increment: 1 },
        lastOtpRequestDate: new Date()
      }
    });

    user.otpRequestCount += 1;
    user.lastOtpRequestDate = new Date();
  }

  private getPasswordResetIssuedAt(passwordResetExpires: Date | null): Date | null {
    if (!passwordResetExpires) {
      return null;
    }

    return new Date(passwordResetExpires.getTime() - AUTH_CONFIG.PASSWORD_RESET_OTP_EXPIRY_MS);
  }

  private isPasswordResetCooldownActive(passwordResetExpires: Date | null, now = new Date()): boolean {
    const issuedAt = this.getPasswordResetIssuedAt(passwordResetExpires);
    if (!issuedAt) {
      return false;
    }

    return now.getTime() - issuedAt.getTime() < AUTH_CONFIG.PASSWORD_RESET_RESEND_COOLDOWN_MS;
  }

  private async countPasswordResetEmailsPastHourTx(tx: AuthTx, userId: number, now = new Date()): Promise<number> {
    return tx.emailLog.count({
      where: {
        userId,
        emailType: EmailType.PASSWORD_RESET_OTP,
        status: {
          in: ['sent', 'preview']
        },
        sentAt: {
          gte: new Date(now.getTime() - 60 * 60 * 1000)
        }
      }
    });
  }

  private async countPasswordResetRequestsByIpPastHour(ipAddress: string | undefined, now = new Date()): Promise<number> {
    if (!ipAddress) {
      return 0;
    }

    return prisma.auditLog.count({
      where: {
        action: AuditAction.PASSWORD_RESET_REQUESTED,
        ipAddress,
        createdAt: {
          gte: new Date(now.getTime() - 60 * 60 * 1000)
        }
      }
    });
  }

  private async issuePasswordResetOtpTx(
    tx: AuthTx,
    user: PasswordResetManagedUser,
    options: {
      requirePendingReset: boolean;
    }
  ): Promise<{
    outcome:
      | 'queued'
      | 'email_not_verified'
      | 'otp_limit_exceeded'
      | 'account_hourly_limit_exceeded'
      | 'pending_reset_missing'
      | 'cooldown_active';
    otp?: string;
  }> {
    const now = new Date();

    if (!user.isVerified) {
      return { outcome: 'email_not_verified' };
    }

    const hasPendingReset =
      Boolean(user.passwordResetToken) &&
      Boolean(user.passwordResetExpires) &&
      Boolean(user.passwordResetExpires && user.passwordResetExpires > now);

    if (options.requirePendingReset && !hasPendingReset) {
      return { outcome: 'pending_reset_missing' };
    }

    if (hasPendingReset && this.isPasswordResetCooldownActive(user.passwordResetExpires ?? null, now)) {
      return { outcome: 'cooldown_active' };
    }

    const recentResetEmails = await this.countPasswordResetEmailsPastHourTx(tx, user.id, now);
    if (recentResetEmails >= AUTH_CONFIG.PASSWORD_RESET_MAX_EMAILS_PER_HOUR) {
      return { outcome: 'account_hourly_limit_exceeded' };
    }

    const otp = generateOTP();
    const otpHash = await hashOtp(otp);
    const expiresAt = new Date(now.getTime() + AUTH_CONFIG.PASSWORD_RESET_OTP_EXPIRY_MS);

    await tx.user.update({
      where: { id: user.id },
      data: {
        passwordResetToken: otpHash,
        passwordResetExpires: expiresAt,
        passwordResetAttemptCount: 0
      }
    });

    return {
      outcome: 'queued',
      otp
    };
  }

  private async createSessionTx(
    tx: AuthTx,
    user: AuthManagedUser,
    deviceId: string
  ) {
    return tx.userSession.create({
      data: {
        userId: user.id,
        deviceId,
        authPolicyVersion: user.authPolicyVersion,
        isActive: true,
        expiresAt: new Date(Date.now() + AUTH_CONFIG.SESSION_EXPIRY_MS)
      }
    });
  }

  private async createResolvedSessionTx(
    tx: AuthTx,
    user: AuthManagedUser,
    resolvedDevice: ResolvedDeviceFingerprint | null,
    message?: string
  ): Promise<AuthSuccessResponse> {
    const sessionDeviceKey = resolvedDevice?.deviceKey ?? createEphemeralSessionDeviceKey();
    const session = await this.createSessionTx(tx, user, sessionDeviceKey);

    return this.buildAuthSuccessResponse(
      user,
      session.id,
      sessionDeviceKey,
      (session as { tokenVersion?: number }).tokenVersion ?? 0,
      message
    );
  }

  private async hasReplacementSession(
    userId: number,
    sessionId: string
  ): Promise<boolean> {
    const count = await prisma.userSession.count({
      where: {
        userId,
        id: { not: sessionId },
        isActive: true
      }
    });

    return count > 0;
  }

  private async invalidateOtherSessionsTx(
    tx: AuthTx,
    userId: number,
    currentSessionId: string
  ): Promise<void> {
    await tx.userSession.updateMany({
      where: {
        userId,
        id: { not: currentSessionId },
        isActive: true
      },
      data: {
        isActive: false
      }
    });
  }

  private async markPremiumDeviceActiveTx(
    tx: AuthTx,
    userId: number,
    deviceId: string
  ): Promise<void> {
    await tx.userDevice.updateMany({
      where: { userId },
      data: { isActive: false }
    });

    await tx.userDevice.updateMany({
      where: {
        userId,
        deviceId
      },
      data: {
        isActive: true,
        lastLoginAt: new Date()
      }
    });
  }

  private async findKnownPremiumDeviceTx(
    tx: AuthTx,
    userId: number,
    resolvedDevice: ResolvedDeviceFingerprint
  ): Promise<UserDevice | null> {
    const exact = await tx.userDevice.findUnique({
      where: {
        userId_deviceId: {
          userId,
          deviceId: resolvedDevice.deviceKey
        }
      }
    });

    if (exact) return exact;

    if (!resolvedDevice.fingerprintHash) {
      if (!resolvedDevice.deviceBindingHash) {
        return null;
      }
    } else {
      const fingerprintMatch = await tx.userDevice.findFirst({
        where: {
          userId,
          fingerprintHash: resolvedDevice.fingerprintHash
        },
        orderBy: [
          { isVerified: 'desc' },
          { lastLoginAt: 'desc' },
          { createdAt: 'desc' }
        ]
      });

      if (fingerprintMatch) {
        return fingerprintMatch;
      }
    }

    if (!resolvedDevice.deviceBindingHash) {
      return null;
    }

    const devices = await tx.userDevice.findMany({
      where: { userId },
      orderBy: [
        { isVerified: 'desc' },
        { lastLoginAt: 'desc' },
        { createdAt: 'desc' }
      ]
    });

    return devices.find((device) => (
      resolveStoredDeviceBindingHash(device.fingerprintData) === resolvedDevice.deviceBindingHash
    )) ?? null;
  }

  private resolvePremiumDeviceOrThrow(
    data: Pick<LoginInput, 'deviceId' | 'deviceName' | 'device'> | Pick<VerifyOtpInput, 'deviceId' | 'deviceName' | 'device'>,
    context: AuthRequestContext
  ): ResolvedDeviceFingerprint {
    const resolvedDevice = resolveDeviceFingerprint(data, context);
    if (!resolvedDevice) {
      throw new AuthError(
        'Premium access needs this device to identify itself before you can sign in.',
        400,
        'PREMIUM_DEVICE_CONTEXT_REQUIRED'
      );
    }
    return resolvedDevice;
  }

  private async upsertTrustedPremiumDeviceTx(
    tx: AuthTx,
    userId: number,
    resolvedDevice: ResolvedDeviceFingerprint,
    existingDevice: UserDevice | null,
    registrationMethod: 'PREMIUM_FIRST_LOGIN' | 'PREMIUM_OTP'
  ): Promise<UserDevice> {
    const canonicalDeviceId = existingDevice?.deviceId ?? resolvedDevice.deviceKey;
    const deviceData = {
      deviceId: canonicalDeviceId,
      deviceName: resolvedDevice.deviceName,
      userAgent: resolvedDevice.userAgent,
      fingerprintHash: resolvedDevice.fingerprintHash,
      fingerprintData: resolvedDevice.fingerprintData as Prisma.InputJsonValue,
      lastIpAddress: resolvedDevice.ipAddress,
      verificationTokenHash: null,
      verificationTokenExpiresAt: null,
      verifiedAt: new Date(),
      registrationMethod,
      isVerified: true,
      isActive: true,
      lastLoginAt: new Date()
    };

    if (existingDevice) {
      return tx.userDevice.update({
        where: { id: existingDevice.id },
        data: deviceData
      });
    }

    return tx.userDevice.create({
      data: {
        userId,
        ...deviceData
      }
    });
  }

  private async issueEmailVerificationOtpTx(
    tx: AuthTx,
    user: AuthManagedUser
  ): Promise<{
    outcome: 'queued' | 'cooldown_active';
    otp?: string;
    expiresAt: Date | null;
  }> {
    const now = new Date();
    const hasActiveOtp =
      Boolean(user.verificationToken) &&
      Boolean(user.tokenExpiresAt) &&
      Boolean(user.tokenExpiresAt && user.tokenExpiresAt > now);

    if (
      hasActiveOtp &&
      this.isOtpResendCooldownActive(
        user.tokenExpiresAt ?? null,
        AUTH_CONFIG.OTP_EXPIRY_MS,
        AUTH_CONFIG.EMAIL_VERIFICATION_RESEND_COOLDOWN_MS,
        now
      )
    ) {
      return {
        outcome: 'cooldown_active',
        expiresAt: user.tokenExpiresAt ?? null
      };
    }

    await this.consumeOtpQuotaTx(tx, user);

    const otp = generateOTP();
    const otpHash = await hashOtp(otp);
    const expiresAt = new Date(now.getTime() + AUTH_CONFIG.OTP_EXPIRY_MS);

    await tx.user.update({
      where: { id: user.id },
      data: {
        verificationToken: otpHash,
        tokenExpiresAt: expiresAt
      }
    });

    return {
      outcome: 'queued',
      otp,
      expiresAt
    };
  }

  private async issuePremiumDeviceOtpTx(
    tx: AuthTx,
    user: AuthManagedUser,
    resolvedDevice: ResolvedDeviceFingerprint,
    existingDevice: UserDevice | null
  ): Promise<{ otp: string; expiresAt: Date }> {
    await this.consumeOtpQuotaTx(tx, user);

    const otp = generateOTP();
    const otpHash = await hashOtp(otp);
    const expiresAt = new Date(Date.now() + AUTH_CONFIG.OTP_EXPIRY_MS);

    const canonicalDeviceId = existingDevice?.deviceId ?? resolvedDevice.deviceKey;
    const baseData = {
      deviceId: canonicalDeviceId,
      deviceName: resolvedDevice.deviceName,
      userAgent: resolvedDevice.userAgent,
      fingerprintHash: resolvedDevice.fingerprintHash,
      fingerprintData: resolvedDevice.fingerprintData as Prisma.InputJsonValue,
      lastIpAddress: resolvedDevice.ipAddress,
      verificationTokenHash: otpHash,
      verificationTokenExpiresAt: expiresAt,
      verifiedAt: null,
      registrationMethod: null,
      isVerified: false,
      isActive: false,
      lastLoginAt: null
    };

    if (existingDevice) {
      await tx.userDevice.update({
        where: { id: existingDevice.id },
        data: baseData
      });
    } else {
      await tx.userDevice.create({
        data: {
          userId: user.id,
          ...baseData
        }
      });
    }

    return {
      otp,
      expiresAt
    };
  }

  private async completePremiumLoginTx(
    tx: AuthTx,
    user: AuthManagedUser,
    resolvedDevice: ResolvedDeviceFingerprint,
    registrationMethod: 'PREMIUM_FIRST_LOGIN' | 'PREMIUM_OTP',
    existingDevice: UserDevice | null
  ): Promise<AuthSuccessResponse> {
    const canonicalDeviceId = existingDevice?.deviceId ?? resolvedDevice.deviceKey;
    await this.upsertTrustedPremiumDeviceTx(tx, user.id, resolvedDevice, existingDevice, registrationMethod);
    const session = await this.createSessionTx(tx, user, canonicalDeviceId);
    await this.invalidateOtherSessionsTx(tx, user.id, session.id);
    await this.markPremiumDeviceActiveTx(tx, user.id, canonicalDeviceId);

    return this.buildAuthSuccessResponse(
      user,
      session.id,
      canonicalDeviceId,
      (session as { tokenVersion?: number }).tokenVersion ?? 0
    );
  }

  private async createFreeSessionTx(
    tx: AuthTx,
    user: AuthManagedUser,
    message?: string
  ): Promise<AuthSuccessResponse> {
    const sessionDeviceKey = createEphemeralSessionDeviceKey();
    const session = await this.createSessionTx(tx, user, sessionDeviceKey);

    return this.buildAuthSuccessResponse(
      user,
      session.id,
      sessionDeviceKey,
      (session as { tokenVersion?: number }).tokenVersion ?? 0,
      message
    );
  }

  private async createFreeSession(
    user: AuthManagedUser,
    message?: string
  ): Promise<AuthSuccessResponse> {
    const sessionDeviceKey = createEphemeralSessionDeviceKey();
    const session = await prisma.userSession.create({
      data: {
        userId: user.id,
        deviceId: sessionDeviceKey,
        authPolicyVersion: user.authPolicyVersion,
        isActive: true,
        expiresAt: new Date(Date.now() + AUTH_CONFIG.SESSION_EXPIRY_MS)
      }
    });

    return this.buildAuthSuccessResponse(
      user,
      session.id,
      sessionDeviceKey,
      (session as { tokenVersion?: number }).tokenVersion ?? 0,
      message
    );
  }

  // REGISTER
  async register(data: RegisterInput, context: AuthRequestContext = {}): Promise<AuthResponse> {
    const existingUser = await prisma.user.findUnique({
      where: { email: data.email },
      select: authManagedUserSelect
    });

    if (existingUser?.isVerified) {
      throw new AuthError('Email already in use', 409, 'EMAIL_ALREADY_IN_USE');
    }

    try {
      let deliveryUser: { id: number; email: string; fullName: string } | null = null;
      let otpToSend: string | null = null;
      let challenge: AuthOtpChallengeResponse | null = null;
      let deliveryReason = 'email_verification_registration';
      let isFreshRegistration = false;

      if (existingUser) {
        challenge = await this.runTransaction(async (tx: AuthTx) => {
          const lockedUser = await getLockedAuthManagedUser(tx, existingUser.id);
          if (!lockedUser) {
            throw new AuthError('Could not continue registration. Please try again.', 409, 'AUTH_STATE_CHANGED');
          }

          if (lockedUser.isVerified) {
            throw new AuthError('Email already in use', 409, 'EMAIL_ALREADY_IN_USE');
          }

          const issued = await this.issueEmailVerificationOtpTx(tx, lockedUser);
          deliveryUser = {
            id: lockedUser.id,
            email: lockedUser.email,
            fullName: lockedUser.fullName
          };
          otpToSend = issued.otp || null;
          deliveryReason = 'email_verification_registration_retry';

          return this.buildEmailVerificationChallenge(
            issued.outcome === 'cooldown_active'
              ? 'This email already has a pending verification. Enter the latest 6-digit code we sent to finish setting up your account.'
              : 'This email already has a pending verification. We sent a fresh 6-digit code to your email to finish setting up your account.',
            issued.expiresAt
          );
        });
      } else {
        const launchInstitution = await institutionContextService.resolveByCode(data.institutionCode);
        const passwordHash = await hashPassword(data.password);
        const otp = generateOTP();
        const otpHash = await hashOtp(otp);
        const expiresAt = new Date(Date.now() + AUTH_CONFIG.OTP_EXPIRY_MS);

        const user = await this.runTransaction(async (tx: AuthTx) => {
          return tx.user.create({
            data: {
              email: data.email,
              passwordHash,
              fullName: data.fullName,
              targetInstitutionId: launchInstitution.id,
              aspiringCourse: data.aspiringCourse,
              targetScore: data.targetScore,
              verificationToken: otpHash,
              tokenExpiresAt: expiresAt,
              lastOtpRequestDate: new Date(),
              otpRequestCount: 1
            }
          });
        });

        deliveryUser = {
          id: user.id,
          email: user.email,
          fullName: user.fullName
        };
        otpToSend = otp;
        isFreshRegistration = true;
        challenge = this.buildEmailVerificationChallenge(
          'Registration successful. Enter the 6-digit code we sent to your email to finish setting up your account.',
          expiresAt
        );
      }

      if (otpToSend && deliveryUser) {
        try {
          const delivery = await this.sendEmailVerificationOtp(deliveryUser, otpToSend, context);
          await this.writeAuditLog(deliveryUser.id, 'OTP_SENT', {
            ipAddress: context.ipAddress,
            userAgent: context.userAgent,
            metadata: {
              reason: deliveryReason,
              deliveryMode: delivery.deliveryMode,
              provider: delivery.provider
            }
          });
        } catch (error) {
          await this.writeAuditLog(deliveryUser.id, 'OTP_FAILED', {
            ipAddress: context.ipAddress,
            userAgent: context.userAgent,
            metadata: {
              reason: deliveryReason,
              deliveryError: (error as Error).message
            }
          });

          if (isFreshRegistration) {
            await prisma.user.deleteMany({
              where: {
                id: deliveryUser.id,
                isVerified: false
              }
            });
          }

          throw error;
        }
      }

      return challenge!;
    } catch (error: any) {
      if (error.code === 'P2002') {
        throw new AuthError('Email already in use', 409, 'EMAIL_ALREADY_IN_USE');
      }
      throw error;
    }
  }

  // LOGIN
  async login(data: LoginInput, context: AuthRequestContext = {}): Promise<AuthResponse> {
    const candidate = await prisma.user.findUnique({
      where: { email: data.email },
      select: authManagedUserSelect
    });

    if (!candidate) {
      await this.writeAuditLog(null, 'LOGIN_FAILED', {
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
        metadata: { email: data.email, reason: 'user_not_found' }
      });
      throw new AuthError('Invalid credentials', 401);
    }

    const isValid = await verifyPassword(data.password, candidate.passwordHash);
    if (!isValid) {
      await this.writeAuditLog(candidate.id, 'LOGIN_FAILED', {
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
        metadata: { reason: 'invalid_password' }
      });
      throw new AuthError('Invalid credentials', 401);
    }

    this.throwIfBanned(candidate);

    if (!candidate.isVerified) {
      let emailVerificationChallenge: AuthOtpChallengeResponse | null = null;
      let emailVerificationOtp: string | null = null;

      await this.runTransaction(async (tx: AuthTx) => {
        const lockedUser = await getLockedAuthManagedUser(tx, candidate.id);
        if (!lockedUser) {
          throw new AuthError('User not found', 404);
        }

        this.throwIfBanned(lockedUser);

        if (lockedUser.isVerified) {
          throw new AuthError('Your email was just verified. Please sign in again.', 409, 'AUTH_STATE_CHANGED');
        }

        const issued = await this.issueEmailVerificationOtpTx(tx, lockedUser);
        emailVerificationOtp = issued.otp || null;
        emailVerificationChallenge = this.buildEmailVerificationChallenge(
          issued.outcome === 'cooldown_active'
            ? 'Your email is not verified yet. Enter the latest 6-digit code we already sent, or request a new one when the resend timer ends.'
            : 'Your email is not verified yet. We sent a fresh 6-digit code to your email to finish signing you in.',
          issued.expiresAt
        );
      });

      if (emailVerificationOtp) {
        try {
          const delivery = await this.sendEmailVerificationOtp(candidate, emailVerificationOtp, context);
          await this.writeAuditLog(candidate.id, 'OTP_SENT', {
            ipAddress: context.ipAddress,
            userAgent: context.userAgent,
            metadata: {
              reason: 'email_verification_login',
              deliveryMode: delivery.deliveryMode,
              provider: delivery.provider
            }
          });
        } catch (error) {
          await this.writeAuditLog(candidate.id, 'OTP_FAILED', {
            ipAddress: context.ipAddress,
            userAgent: context.userAgent,
            metadata: {
              reason: 'email_verification_login',
              deliveryError: (error as Error).message
            }
          });

          throw error;
        }
      }

      return emailVerificationChallenge!;
    }

    if (!candidate.isPremium && candidate.deviceAccessMode === 'FREE') {
      const response = await this.createFreeSession(candidate);
      await this.writeAuditLog(candidate.id, 'LOGIN_SUCCESS', {
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
        metadata: { accessMode: 'free' }
      });
      return response;
    }

    const resolvedPremiumDevice = candidate.isPremium
      ? this.resolvePremiumDeviceOrThrow(data, context)
      : null;

    let otpToSend: string | null = null;
    let otpExpiresAt: Date | null = null;
    let auditDeviceId: string | undefined;
    let auditDeviceName: string | undefined;

    const result = await this.runTransaction(async (tx: AuthTx) => {
      const lockedUser = await getLockedAuthManagedUser(tx, candidate.id);
      if (!lockedUser) {
        throw new AuthError('User not found', 404);
      }

      this.throwIfBanned(lockedUser);

      const user = await reconcilePremiumAccessTx(tx, lockedUser.id);
      if (!user) {
        throw new AuthError('User not found', 404);
      }

      if (!user.isVerified) {
        throw new AuthError('Email not verified. Please verify your email first.', 403, 'EMAIL_NOT_VERIFIED');
      }

      if (!user.isPremium) {
        return this.createFreeSessionTx(tx, user);
      }

      if (this.isPrivilegedDevicePolicyExempt(user)) {
        const exemptDevice = resolveDeviceFingerprint(data, context);
        auditDeviceId = exemptDevice?.deviceKey;
        auditDeviceName = exemptDevice?.deviceName;
        return this.createResolvedSessionTx(tx, user, exemptDevice);
      }

      const resolvedDevice = resolvedPremiumDevice || this.resolvePremiumDeviceOrThrow(data, context);
      auditDeviceId = resolvedDevice.deviceKey;
      auditDeviceName = resolvedDevice.deviceName;

      const knownDevice = await this.findKnownPremiumDeviceTx(tx, user.id, resolvedDevice);

      if (knownDevice?.isVerified) {
        return this.completePremiumLoginTx(tx, user, resolvedDevice, knownDevice.registrationMethod ?? 'PREMIUM_OTP', knownDevice);
      }

      await tx.userDevice.deleteMany({
        where: {
          userId: user.id,
          isVerified: false,
          id: knownDevice ? { not: knownDevice.id } : undefined
        }
      });

      const verifiedDeviceCount = await tx.userDevice.count({
        where: {
          userId: user.id,
          isVerified: true
        }
      });

      if (verifiedDeviceCount === 0) {
        return this.completePremiumLoginTx(tx, user, resolvedDevice, 'PREMIUM_FIRST_LOGIN', knownDevice);
      }

      if (verifiedDeviceCount >= AUTH_CONFIG.MAX_DEVICES && !knownDevice) {
        throw new AuthError(
          `Your premium plan already has ${AUTH_CONFIG.MAX_DEVICES} registered devices. Sign in with one of them or remove one before adding another.`,
          403,
          'MAX_DEVICES_REACHED'
        );
      }

      const issuedDeviceOtp = await this.issuePremiumDeviceOtpTx(tx, user, resolvedDevice, knownDevice);
      otpToSend = issuedDeviceOtp.otp;
      otpExpiresAt = issuedDeviceOtp.expiresAt;

      return this.buildOtpChallengeResponse(
        'DEVICE_REGISTRATION',
        'We sent a 6-digit code to your email to approve this premium device.',
        {
          otpExpiresAt
        }
      ) satisfies AuthResponse;
    });

    if (otpToSend) {
      try {
        const delivery = await this.sendPremiumDeviceOtp(candidate, otpToSend, auditDeviceName, context);
        await this.writeAuditLog(candidate.id, 'OTP_SENT', {
          deviceId: auditDeviceId,
          ipAddress: context.ipAddress,
          userAgent: context.userAgent,
          metadata: {
            reason: 'premium_device_registration',
            deliveryMode: delivery.deliveryMode,
            provider: delivery.provider
          }
        });
      } catch (error) {
        await this.writeAuditLog(candidate.id, 'OTP_FAILED', {
          deviceId: auditDeviceId,
          ipAddress: context.ipAddress,
          userAgent: context.userAgent,
          metadata: {
            reason: 'premium_device_registration',
            deliveryError: (error as Error).message
          }
        });

        throw error;
      }
    } else if (!result.requiresOTP) {
      await this.writeAuditLog(candidate.id, 'LOGIN_SUCCESS', {
        deviceId: auditDeviceId,
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
        metadata: { accessMode: candidate.isPremium ? 'premium' : 'free' }
      });
    }

    return result;
  }

  // VERIFY OTP
  async verifyOtp(data: VerifyOtpInput, context: AuthRequestContext = {}): Promise<AuthSuccessResponse> {
    const candidate = await prisma.user.findUnique({
      where: { email: data.email },
      select: authManagedUserSelect
    });

    if (!candidate) {
      throw new AuthError('User not found', 404);
    }

    this.throwIfBanned(candidate);

    if (!candidate.isVerified) {
      const otp = data.otp.trim();

      return this.runTransaction(async (tx: AuthTx) => {
        const lockedUser = await getLockedAuthManagedUser(tx, candidate.id);
        if (!lockedUser) {
          throw new AuthError('User not found', 404);
        }

        this.throwIfBanned(lockedUser);

        if (lockedUser.isVerified) {
          throw new AuthError('Your email is already verified. Please sign in instead.', 400, 'OTP_CONTEXT_INVALID');
        }

        if (!lockedUser.verificationToken || !lockedUser.tokenExpiresAt || lockedUser.tokenExpiresAt < new Date()) {
          throw new AuthError(
            'Your email verification code is invalid or expired. Request a fresh code and try again.',
            400,
            'EMAIL_OTP_INVALID'
          );
        }

        const isMatch = await verifyOtpHash(otp, lockedUser.verificationToken);
        if (!isMatch) {
          throw new AuthError('Your email verification code is not correct.', 400, 'EMAIL_OTP_INVALID');
        }

        const user = await tx.user.update({
          where: { id: lockedUser.id },
          data: {
            isVerified: true,
            verificationToken: null,
            tokenExpiresAt: null,
            otpRequestCount: 0,
            lastOtpRequestDate: null
          },
          select: authManagedUserSelect
        });

        const response = await this.createFreeSessionTx(
          tx,
          user,
          'Email verified. You are now signed in.'
        );

        await tx.auditLog.create({
          data: {
            userId: user.id,
            action: 'OTP_VERIFIED',
            ipAddress: context.ipAddress,
            userAgent: context.userAgent,
            metadata: { reason: 'email_verification_completed' }
          }
        });

        return response;
      });
    }

    const resolvedDevice = this.resolvePremiumDeviceOrThrow(data, context);

    return this.runTransaction(async (tx: AuthTx) => {
      const lockedUser = await getLockedAuthManagedUser(tx, candidate.id);
      if (!lockedUser) {
        throw new AuthError('User not found', 404);
      }

      this.throwIfBanned(lockedUser);

      const user = await reconcilePremiumAccessTx(tx, lockedUser.id);
      if (!user) {
        throw new AuthError('User not found', 404);
      }

      if (!user.isPremium) {
        throw new AuthError(
          'This account does not need premium device verification right now. Please sign in again.',
          400,
          'OTP_CONTEXT_INVALID'
        );
      }

      const device = await this.findKnownPremiumDeviceTx(tx, user.id, resolvedDevice);

      if (!device || device.isVerified) {
        throw new AuthError(
          'We could not find a pending premium device verification for this device. Start sign-in again to request a new code.',
          400,
          'DEVICE_OTP_INVALID'
        );
      }

      if (!device.verificationTokenHash || !device.verificationTokenExpiresAt || device.verificationTokenExpiresAt < new Date()) {
        throw new AuthError(
          'Your premium device verification code is invalid or expired. Start sign-in again to get a fresh code.',
          400,
          'DEVICE_OTP_INVALID'
        );
      }

      const isMatch = await verifyOtpHash(data.otp.trim(), device.verificationTokenHash);
      if (!isMatch) {
        throw new AuthError('Your premium device verification code is not correct.', 400, 'DEVICE_OTP_INVALID');
      }

      const verifiedDeviceCount = await tx.userDevice.count({
        where: {
          userId: user.id,
          isVerified: true
        }
      });

      if (verifiedDeviceCount >= AUTH_CONFIG.MAX_DEVICES) {
        throw new AuthError(
          `Your premium plan already has ${AUTH_CONFIG.MAX_DEVICES} registered devices. Remove one before approving a new device.`,
          403,
          'MAX_DEVICES_REACHED'
        );
      }

      const response = await this.completePremiumLoginTx(tx, user, resolvedDevice, 'PREMIUM_OTP', device);

      await tx.auditLog.create({
        data: {
          userId: user.id,
          action: 'DEVICE_VERIFIED',
          deviceId: resolvedDevice.deviceKey,
          ipAddress: context.ipAddress,
          userAgent: context.userAgent,
          metadata: { reason: 'premium_device_verified' }
        }
      });

      return {
        ...response,
        message: 'Device verified successfully. You are now signed in on this premium device.'
      };
    });
  }

  async resendVerificationOtp(
    data: ResendVerificationOtpInput,
    context: AuthRequestContext = {}
  ): Promise<AuthVerificationResendResponse> {
    const candidate = await prisma.user.findUnique({
      where: { email: data.email },
      select: authManagedUserSelect
    });

    if (!candidate || candidate.isVerified) {
      return {
        message: EMAIL_VERIFICATION_RESEND_MESSAGE
      };
    }

    this.throwIfBanned(candidate);

    let otpToSend: string | null = null;
    let response: AuthVerificationResendResponse = {
      message: EMAIL_VERIFICATION_RESEND_MESSAGE
    };

    await this.runTransaction(async (tx: AuthTx) => {
      const lockedUser = await getLockedAuthManagedUser(tx, candidate.id);
      if (!lockedUser) {
        throw new AuthError('User not found', 404);
      }

      this.throwIfBanned(lockedUser);

      if (lockedUser.isVerified) {
        response = {
          message: EMAIL_VERIFICATION_RESEND_MESSAGE
        };
        return;
      }

      const issued = await this.issueEmailVerificationOtpTx(tx, lockedUser);
      otpToSend = issued.otp || null;
      response = this.buildVerificationResendResponse(
        issued.outcome === 'cooldown_active'
          ? 'A verification code is already active for this email. Enter the latest code or wait for the resend timer to finish.'
          : 'We sent a fresh 6-digit code to your email. Enter it below to finish verifying your account.',
        issued.expiresAt
      );
    });

    if (!otpToSend) {
      return response;
    }

    try {
      const delivery = await this.sendEmailVerificationOtp(candidate, otpToSend, context);
      await this.writeAuditLog(candidate.id, 'OTP_SENT', {
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
        metadata: {
          reason: 'email_verification_resend',
          deliveryMode: delivery.deliveryMode,
          provider: delivery.provider
        }
      });
    } catch (error) {
      await this.writeAuditLog(candidate.id, 'OTP_FAILED', {
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
        metadata: {
          reason: 'email_verification_resend',
          deliveryError: (error as Error).message
        }
      });

      throw error;
    }

    return response;
  }

  async forgotPassword(
    data: ForgotPasswordInput,
    context: AuthRequestContext = {}
  ): Promise<AuthMessageResponse> {
    const recentIpRequests = await this.countPasswordResetRequestsByIpPastHour(context.ipAddress);
    if (recentIpRequests >= AUTH_CONFIG.PASSWORD_RESET_MAX_REQUESTS_PER_IP_PER_HOUR) {
      await this.writeAuditLog(null, AuditAction.PASSWORD_RESET_REQUESTED, {
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
        metadata: {
          email: data.email,
          delivered: false,
          reason: 'ip_hourly_limit_exceeded'
        }
      });

      return {
        message: PASSWORD_RESET_REQUEST_MESSAGE
      };
    }

    const candidate = await prisma.user.findUnique({
      where: { email: data.email },
      select: passwordResetManagedUserSelect
    });

    if (!candidate) {
      await this.writeAuditLog(null, AuditAction.PASSWORD_RESET_REQUESTED, {
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
        metadata: {
          email: data.email,
          delivered: false,
          reason: 'user_not_found'
        }
      });

      return {
        message: PASSWORD_RESET_REQUEST_MESSAGE
      };
    }

    let otpToSend: string | null = null;
    let requestOutcome:
      | 'queued'
      | 'email_not_verified'
      | 'otp_limit_exceeded'
      | 'account_hourly_limit_exceeded'
      | 'pending_reset_missing'
      | 'cooldown_active'
      | 'user_missing_after_lock' = 'queued';

    await this.runTransaction(async (tx: AuthTx) => {
      await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${candidate.id} FOR UPDATE`;

      const lockedUser = await tx.user.findUnique({
        where: { id: candidate.id },
        select: passwordResetManagedUserSelect
      });

      if (!lockedUser) {
        requestOutcome = 'user_missing_after_lock';
        return;
      }

      const issued = await this.issuePasswordResetOtpTx(tx, lockedUser, {
        requirePendingReset: false
      });

      requestOutcome = issued.outcome;
      otpToSend = issued.otp || null;
    });

    if (requestOutcome !== 'queued' || !otpToSend) {
      await this.writeAuditLog(candidate.id, AuditAction.PASSWORD_RESET_REQUESTED, {
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
        metadata: {
          email: candidate.email,
          delivered: false,
          reason: requestOutcome
        }
      });

      return {
        message: PASSWORD_RESET_REQUEST_MESSAGE
      };
    }

    try {
      const delivery = await this.sendPasswordResetOtp(candidate, otpToSend, context);

      await this.writeAuditLog(candidate.id, AuditAction.PASSWORD_RESET_REQUESTED, {
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
        metadata: {
          email: candidate.email,
          delivered: true,
          reason: 'password_reset',
          deliveryMode: delivery.deliveryMode,
          provider: delivery.provider
        }
      });

      await this.writeAuditLog(candidate.id, AuditAction.OTP_SENT, {
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
        metadata: {
          reason: 'password_reset',
          deliveryMode: delivery.deliveryMode,
          provider: delivery.provider
        }
      });
    } catch (error) {
      await this.writeAuditLog(candidate.id, AuditAction.PASSWORD_RESET_REQUESTED, {
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
        metadata: {
          email: candidate.email,
          delivered: false,
          reason: 'delivery_failed',
          deliveryError: (error as Error).message
        }
      });

      await this.writeAuditLog(candidate.id, AuditAction.OTP_FAILED, {
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
        metadata: {
          reason: 'password_reset',
          deliveryError: (error as Error).message
        }
      });
    }

    return {
      message: PASSWORD_RESET_REQUEST_MESSAGE
    };
  }

  async resendResetPasswordOtp(
    data: ForgotPasswordInput,
    context: AuthRequestContext = {}
  ): Promise<AuthMessageResponse> {
    const recentIpRequests = await this.countPasswordResetRequestsByIpPastHour(context.ipAddress);
    if (recentIpRequests >= AUTH_CONFIG.PASSWORD_RESET_MAX_REQUESTS_PER_IP_PER_HOUR) {
      await this.writeAuditLog(null, AuditAction.PASSWORD_RESET_REQUESTED, {
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
        metadata: {
          email: data.email,
          delivered: false,
          reason: 'ip_hourly_limit_exceeded'
        }
      });

      return {
        message: PASSWORD_RESET_RESEND_MESSAGE
      };
    }

    const candidate = await prisma.user.findUnique({
      where: { email: data.email },
      select: passwordResetManagedUserSelect
    });

    if (!candidate) {
      await this.writeAuditLog(null, AuditAction.PASSWORD_RESET_REQUESTED, {
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
        metadata: {
          email: data.email,
          delivered: false,
          reason: 'resend_user_not_found'
        }
      });

      return {
        message: PASSWORD_RESET_RESEND_MESSAGE
      };
    }

    let otpToSend: string | null = null;
    let resendOutcome:
      | 'queued'
      | 'email_not_verified'
      | 'otp_limit_exceeded'
      | 'account_hourly_limit_exceeded'
      | 'pending_reset_missing'
      | 'cooldown_active'
      | 'user_missing_after_lock' = 'queued';

    await this.runTransaction(async (tx: AuthTx) => {
      await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${candidate.id} FOR UPDATE`;

      const lockedUser = await tx.user.findUnique({
        where: { id: candidate.id },
        select: passwordResetManagedUserSelect
      });

      if (!lockedUser) {
        resendOutcome = 'user_missing_after_lock';
        return;
      }

      const issued = await this.issuePasswordResetOtpTx(tx, lockedUser, {
        requirePendingReset: true
      });

      resendOutcome = issued.outcome;
      otpToSend = issued.otp || null;
    });

    if (resendOutcome !== 'queued' || !otpToSend) {
      await this.writeAuditLog(candidate.id, AuditAction.PASSWORD_RESET_REQUESTED, {
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
        metadata: {
          email: candidate.email,
          delivered: false,
          reason: resendOutcome
        }
      });

      return {
        message: PASSWORD_RESET_RESEND_MESSAGE
      };
    }

    try {
      const delivery = await this.sendPasswordResetOtp(candidate, otpToSend, context);

      await this.writeAuditLog(candidate.id, AuditAction.PASSWORD_RESET_REQUESTED, {
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
        metadata: {
          email: candidate.email,
          delivered: true,
          reason: 'password_reset_resend',
          deliveryMode: delivery.deliveryMode,
          provider: delivery.provider
        }
      });

      await this.writeAuditLog(candidate.id, AuditAction.OTP_SENT, {
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
        metadata: {
          reason: 'password_reset_resend',
          deliveryMode: delivery.deliveryMode,
          provider: delivery.provider
        }
      });
    } catch (error) {
      await this.writeAuditLog(candidate.id, AuditAction.PASSWORD_RESET_REQUESTED, {
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
        metadata: {
          email: candidate.email,
          delivered: false,
          reason: 'resend_delivery_failed',
          deliveryError: (error as Error).message
        }
      });

      await this.writeAuditLog(candidate.id, AuditAction.OTP_FAILED, {
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
        metadata: {
          reason: 'password_reset_resend',
          deliveryError: (error as Error).message
        }
      });
    }

    return {
      message: PASSWORD_RESET_RESEND_MESSAGE
    };
  }

  async resetPassword(
    data: ResetPasswordInput,
    context: AuthRequestContext = {}
  ): Promise<AuthMessageResponse> {
    const resetCode = data.otp.trim();
    let resetFailure:
      | 'PASSWORD_RESET_OTP_INVALID'
      | 'PASSWORD_RESET_ATTEMPT_LIMIT_EXCEEDED'
      | null = null;

    const candidate = await prisma.user.findUnique({
      where: { email: data.email },
      select: {
        id: true,
        passwordHash: true,
        isVerified: true,
        passwordResetAttemptCount: true,
        passwordResetToken: true,
        passwordResetExpires: true
      }
    });

    if (
      !candidate ||
      !candidate.isVerified ||
      !candidate.passwordResetToken ||
      !candidate.passwordResetExpires ||
      candidate.passwordResetExpires < new Date()
    ) {
      throw new AuthError(
        'Your password reset code is invalid or expired. Request a fresh code and try again.',
        400,
        'PASSWORD_RESET_OTP_INVALID'
      );
    }

    const nextPasswordHash = await hashPassword(data.newPassword);
    const changedAt = new Date();

    await this.runTransaction(async (tx: AuthTx) => {
      await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${candidate.id} FOR UPDATE`;

      const lockedUser = await tx.user.findUnique({
        where: { id: candidate.id },
        select: {
          id: true,
          passwordHash: true,
          isVerified: true,
          passwordResetAttemptCount: true,
          passwordResetToken: true,
          passwordResetExpires: true
        }
      });

      if (
        !lockedUser ||
        !lockedUser.isVerified ||
        !lockedUser.passwordResetToken ||
        !lockedUser.passwordResetExpires ||
        lockedUser.passwordResetExpires < new Date()
      ) {
        throw new AuthError(
          'Your password reset code is invalid or expired. Request a fresh code and try again.',
          400,
          'PASSWORD_RESET_OTP_INVALID'
        );
      }

      if (lockedUser.passwordResetAttemptCount >= AUTH_CONFIG.PASSWORD_RESET_MAX_VERIFY_ATTEMPTS) {
        await tx.user.update({
          where: { id: lockedUser.id },
          data: {
            passwordResetToken: null,
            passwordResetExpires: null,
            passwordResetAttemptCount: 0
          }
        });

        resetFailure = 'PASSWORD_RESET_ATTEMPT_LIMIT_EXCEEDED';
        return;
      }

      const lockedOtpMatches = await verifyOtpHash(resetCode, lockedUser.passwordResetToken);
      if (!lockedOtpMatches) {
        const nextFailedAttempt = lockedUser.passwordResetAttemptCount + 1;

        await tx.auditLog.create({
          data: {
            userId: lockedUser.id,
            action: AuditAction.OTP_FAILED,
            ipAddress: context.ipAddress,
            userAgent: context.userAgent,
            metadata: {
              reason: 'password_reset',
              attemptNumber: nextFailedAttempt
            }
          }
        });

        await tx.user.update({
          where: { id: lockedUser.id },
          data: {
            passwordResetAttemptCount:
              nextFailedAttempt >= AUTH_CONFIG.PASSWORD_RESET_MAX_VERIFY_ATTEMPTS
                ? 0
                : nextFailedAttempt,
            ...(nextFailedAttempt >= AUTH_CONFIG.PASSWORD_RESET_MAX_VERIFY_ATTEMPTS
              ? {
                  passwordResetToken: null,
                  passwordResetExpires: null
                }
              : {})
          }
        });

        if (nextFailedAttempt >= AUTH_CONFIG.PASSWORD_RESET_MAX_VERIFY_ATTEMPTS) {
          resetFailure = 'PASSWORD_RESET_ATTEMPT_LIMIT_EXCEEDED';
          return;
        }

        resetFailure = 'PASSWORD_RESET_OTP_INVALID';
        return;
      }

      const lockedPasswordReuse = await verifyPassword(data.newPassword, lockedUser.passwordHash);
      if (lockedPasswordReuse) {
        throw new AuthError(
          'Your new password must be different from your current StudyBond password.',
          400,
          'PASSWORD_REUSE'
        );
      }

      await assertPasswordChangeAllowed(tx, lockedUser.id, changedAt);

      const passwordUpdated = await tx.user.updateMany({
        where: {
          id: lockedUser.id,
          passwordResetToken: lockedUser.passwordResetToken,
          passwordResetExpires: lockedUser.passwordResetExpires
        },
        data: {
          passwordHash: nextPasswordHash,
          lastPasswordChange: changedAt,
          passwordResetToken: null,
          passwordResetExpires: null,
          passwordResetAttemptCount: 0,
          otpRequestCount: 0,
          lastOtpRequestDate: null
        }
      });

      if (passwordUpdated.count !== 1) {
        throw new AuthError(
          'Your password reset code is invalid or expired. Request a fresh code and try again.',
          400,
          'PASSWORD_RESET_OTP_INVALID'
        );
      }

      const invalidatedSessions = await tx.userSession.updateMany({
        where: {
          userId: lockedUser.id,
          isActive: true
        },
        data: {
          isActive: false
        }
      });

      await tx.userDevice.updateMany({
        where: { userId: lockedUser.id },
        data: { isActive: false }
      });

      await tx.auditLog.create({
        data: {
          userId: lockedUser.id,
          action: AuditAction.OTP_VERIFIED,
          ipAddress: context.ipAddress,
          userAgent: context.userAgent,
          metadata: {
            reason: 'password_reset'
          }
        }
      });

      await tx.auditLog.create({
        data: {
          userId: lockedUser.id,
          action: AuditAction.PASSWORD_CHANGED,
          ipAddress: context.ipAddress,
          userAgent: context.userAgent,
          metadata: {
            reason: 'password_reset',
            invalidatedSessions: invalidatedSessions.count
          }
        }
      });
    });

    if (resetFailure === 'PASSWORD_RESET_ATTEMPT_LIMIT_EXCEEDED') {
      throw new AuthError(
        'Too many invalid reset attempts were made for this code. Request a fresh code and try again.',
        429,
        'PASSWORD_RESET_ATTEMPT_LIMIT_EXCEEDED'
      );
    }

    if (resetFailure === 'PASSWORD_RESET_OTP_INVALID') {
      throw new AuthError(
        'Your password reset code is invalid or expired. Request a fresh code and try again.',
        400,
        'PASSWORD_RESET_OTP_INVALID'
      );
    }

    return {
      message: 'Your password was reset successfully. Sign in with your new password to continue.'
    };
  }

  // REFRESH TOKEN
  async refreshToken(refreshToken: string) {
    const payload = verifyRefreshToken(refreshToken);
    if (!payload) {
      throw new AuthError('Invalid or expired refresh token', 401);
    }

    let session = await prisma.userSession.findUnique({
      where: { id: payload.sessionId },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            role: true,
            isBanned: true,
            bannedReason: true,
            isPremium: true,
            subscriptionEndDate: true,
            deviceAccessMode: true,
            authPolicyVersion: true
          }
        }
      }
    });

    if (
      session &&
      (((session.user.isPremium &&
        session.user.subscriptionEndDate &&
        session.user.subscriptionEndDate <= new Date()) ||
        (session.user.isPremium && session.user.deviceAccessMode !== 'PREMIUM')) ||
        (!session.user.isPremium && session.user.deviceAccessMode !== 'FREE'))
    ) {
      await reconcileAuthAccessMode(session.user.id);
      session = await prisma.userSession.findUnique({
        where: { id: payload.sessionId },
        include: {
          user: {
            select: {
              id: true,
              email: true,
              role: true,
              isBanned: true,
              bannedReason: true,
              isPremium: true,
              subscriptionEndDate: true,
              deviceAccessMode: true,
              authPolicyVersion: true
            }
          }
        }
      });
    }

    if (session && !session.isActive && await this.hasReplacementSession(session.userId, session.id)) {
      throw new AuthError(
        'We signed you out because this account became active on another device or browser.',
        401,
        'SESSION_REPLACED'
      );
    }

    if (!session || !session.isActive) {
      throw new AuthError('Session invalid or expired', 401);
    }

    this.throwIfBanned(session.user);

    if (session.deviceId !== payload.deviceId) {
      throw new AuthError('Session invalid or expired', 401, 'SESSION_INVALID');
    }

    if (session.authPolicyVersion !== session.user.authPolicyVersion) {
      await prisma.userSession.updateMany({
        where: {
          id: session.id,
          isActive: true
        },
        data: {
          isActive: false
        }
      });
      throw new AuthError('Your session is no longer valid. Please sign in again.', 401, 'SESSION_INVALID');
    }

    if (session.expiresAt && session.expiresAt < new Date()) {
      await prisma.userSession.update({
        where: { id: session.id },
        data: { isActive: false }
      });
      throw new AuthError('Session expired', 401);
    }

    const expectedTokenVersion =
      typeof payload.tokenVersion === 'number'
        ? payload.tokenVersion
        : ((session as { tokenVersion?: number }).tokenVersion ?? 0);

    const sessionTokenVersion = (session as { tokenVersion?: number }).tokenVersion ?? 0;
    const refreshDecision = decideRefreshTokenRotation(sessionTokenVersion, expectedTokenVersion);

    if (refreshDecision.action === 'reuse-current') {
      return generateTokens(
        {
          id: session.user.id,
          email: session.user.email,
          role: session.user.role
        },
        session.id,
        payload.deviceId,
        refreshDecision.tokenVersion
      );
    }

    if (refreshDecision.action === 'reject') {
      throw new AuthError('Refresh token replay detected. Please log in again.', 401, 'SESSION_INVALID');
    }

    const rotated = await prisma.userSession.updateMany({
      where: {
        id: session.id,
        isActive: true,
        tokenVersion: sessionTokenVersion,
        authPolicyVersion: session.user.authPolicyVersion
      },
      data: {
        tokenVersion: { increment: 1 }
      }
    });

    if (rotated.count !== 1) {
      throw new AuthError('Session rotation failed due to a concurrent refresh attempt.', 401, 'SESSION_INVALID');
    }

    return generateTokens(
      {
        id: session.user.id,
        email: session.user.email,
        role: session.user.role
      },
      session.id,
      payload.deviceId,
      refreshDecision.nextTokenVersion
    );
  }

  // LOGOUT
  async logout(userId: number, sessionId: string) {
    const session = await prisma.userSession.findFirst({
      where: {
        id: sessionId,
        userId
      },
      include: {
        user: {
          select: {
            isPremium: true
          }
        }
      }
    });

    if (!session) {
      return { message: 'Logged out successfully' };
    }

    await prisma.userSession.updateMany({
      where: {
        id: sessionId,
        userId,
        isActive: true
      },
      data: {
        isActive: false
      }
    });

    if (session.user.isPremium) {
      const remainingActiveSessions = await prisma.userSession.count({
        where: {
          userId,
          deviceId: session.deviceId,
          isActive: true
        }
      });

      if (remainingActiveSessions === 0) {
        await prisma.userDevice.updateMany({
          where: {
            userId,
            deviceId: session.deviceId
          },
          data: {
            isActive: false
          }
        });
      }
    }

    await this.writeAuditLog(userId, 'LOGOUT', {
      deviceId: session.deviceId
    });

    return { message: 'Logged out successfully' };
  }
}
