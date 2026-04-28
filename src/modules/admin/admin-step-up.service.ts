import { AdminStepUpPurpose, EmailType, Prisma } from '@prisma/client';
import { randomBytes } from 'crypto';
import prisma from '../../config/database';
import { ADMIN_CONFIG, AUTH_CONFIG } from '../../config/constants';
import { generateOTP } from '../auth/auth.utils';
import { hashOtp, verifyOtpHash } from '../../shared/utils/hash';
import { AppError } from '../../shared/errors/AppError';
import { ForbiddenError } from '../../shared/errors/ForbiddenError';
import { transactionalEmailService } from '../../shared/email/email.service';
import { buildAdminStepUpOtpTemplate } from '../../shared/email/email.templates';
import {
    AdminRequestContext,
    AdminStepUpRequestResponse,
    AdminStepUpVerifyInput,
    AdminStepUpVerifyResponse
} from './admin.types';

type AdminTx = Prisma.TransactionClient;

const STEP_UP_PURPOSE = AdminStepUpPurpose.SUPERADMIN_SENSITIVE_ACTION;

type ActiveSessionActor = {
    id: number;
    email: string;
    fullName: string;
};

type ActiveSession = {
    id: string;
    userId: number;
    isActive: boolean;
    expiresAt: Date | null;
    user: ActiveSessionActor;
};

export class AdminStepUpService {
    private runTransaction<T>(operation: (tx: AdminTx) => Promise<T>): Promise<T> {
        return prisma.$transaction(operation, {
            maxWait: AUTH_CONFIG.TX_MAX_WAIT_MS,
            timeout: AUTH_CONFIG.TX_TIMEOUT_MS
        });
    }

    private assertSuperadmin(actorRole: string): void {
        if (actorRole !== 'SUPERADMIN') {
            throw new ForbiddenError('Superadmin access is required for admin step-up actions.');
        }
    }

    private requireSessionId(context: AdminRequestContext): string {
        if (!context.sessionId) {
            throw new AppError(
                'Your admin session context is missing. Please log in again before retrying this action.',
                401,
                'SESSION_INVALID'
            );
        }

        return context.sessionId;
    }

    private async getActiveSessionTx(
        tx: AdminTx,
        actorId: number,
        sessionId: string
    ): Promise<ActiveSession> {
        const session = await tx.userSession.findUnique({
            where: { id: sessionId },
            select: {
                id: true,
                userId: true,
                isActive: true,
                expiresAt: true,
                user: {
                    select: {
                        id: true,
                        email: true,
                        fullName: true
                    }
                }
            }
        });

        if (!session || session.userId !== actorId || !session.isActive) {
            throw new AppError(
                'Your admin session is no longer active. Please log in again before continuing.',
                401,
                'SESSION_INVALID'
            );
        }

        if (session.expiresAt && session.expiresAt <= new Date()) {
            throw new AppError(
                'Your admin session has expired. Please log in again before continuing.',
                401,
                'SESSION_INVALID'
            );
        }

        return session;
    }

    private async writeAdminAuditTx(
        tx: AdminTx,
        entry: {
            actorId: number;
            actorRole: string;
            action: 'STEP_UP_CHALLENGE_REQUESTED' | 'STEP_UP_CHALLENGE_VERIFIED' | 'STEP_UP_CHALLENGE_FAILED';
            targetId?: string;
            metadata?: Prisma.InputJsonValue;
            reason?: string;
            ipAddress?: string;
        }
    ): Promise<void> {
        await tx.adminAuditLog.create({
            data: {
                actorId: entry.actorId,
                actorRole: entry.actorRole,
                action: entry.action,
                targetType: 'SYSTEM',
                targetId: entry.targetId,
                metadata: entry.metadata,
                reason: entry.reason,
                ipAddress: entry.ipAddress
            }
        });
    }

    private async writeFailureAudit(
        entry: {
            actorId: number;
            actorRole: string;
            targetId?: string;
            metadata?: Prisma.InputJsonValue;
            reason?: string;
            ipAddress?: string;
        }
    ): Promise<void> {
        try {
            await prisma.adminAuditLog.create({
                data: {
                    actorId: entry.actorId,
                    actorRole: entry.actorRole,
                    action: 'STEP_UP_CHALLENGE_FAILED',
                    targetType: 'SYSTEM',
                    targetId: entry.targetId,
                    metadata: entry.metadata,
                    reason: entry.reason,
                    ipAddress: entry.ipAddress
                }
            });
        } catch (error) {
            console.error('[ADMIN_STEP_UP_AUDIT_FAILURE]', { entry, error });
        }
    }

    async requestChallenge(
        actorId: number,
        actorRole: string,
        context: AdminRequestContext = {}
    ): Promise<AdminStepUpRequestResponse> {
        this.assertSuperadmin(actorRole);

        const sessionId = this.requireSessionId(context);
        const challengeState = await this.runTransaction(async (tx: AdminTx) => {
            const session = await this.getActiveSessionTx(tx, actorId, sessionId);
            const otp = generateOTP();
            const otpHash = await hashOtp(otp);
            const expiresAt = new Date(Date.now() + ADMIN_CONFIG.STEP_UP_OTP_EXPIRY_MS);

            const challenge = await tx.adminStepUpChallenge.upsert({
                where: {
                    actorId_sessionId_purpose: {
                        actorId,
                        sessionId,
                        purpose: STEP_UP_PURPOSE
                    }
                },
                update: {
                    otpHash,
                    otpExpiresAt: expiresAt,
                    verifiedTokenHash: null,
                    verifiedTokenExpiresAt: null,
                    verifiedAt: null,
                    failedAttempts: 0,
                    lastUsedAt: null
                },
                create: {
                    actorId,
                    sessionId,
                    purpose: STEP_UP_PURPOSE,
                    otpHash,
                    otpExpiresAt: expiresAt
                }
            });

            await this.writeAdminAuditTx(tx, {
                actorId,
                actorRole,
                action: 'STEP_UP_CHALLENGE_REQUESTED',
                targetId: challenge.id,
                metadata: {
                    purpose: STEP_UP_PURPOSE,
                    sessionId,
                    userAgent: context.userAgent || null
                },
                ipAddress: context.ipAddress
            });

            return {
                challengeId: challenge.id,
                expiresAt,
                actor: session.user,
                otp
            };
        });

        const template = buildAdminStepUpOtpTemplate(challengeState.actor.fullName, challengeState.otp);

        try {
            const delivery = await transactionalEmailService.send({
                userId: actorId,
                emailType: EmailType.ADMIN_STEP_UP_OTP,
                to: {
                    email: challengeState.actor.email,
                    name: challengeState.actor.fullName
                },
                subject: template.subject,
                html: template.html,
                text: template.text,
                isCritical: true,
                debugPreviewCode: challengeState.otp,
                metadata: {
                    purpose: STEP_UP_PURPOSE,
                    sessionId
                }
            });

            return {
                challengeId: challengeState.challengeId,
                purpose: 'SUPERADMIN_SENSITIVE_ACTION',
                expiresAt: challengeState.expiresAt.toISOString(),
                deliveryMode: delivery.deliveryMode === 'SUPPRESSED' ? 'DEV_PREVIEW' : delivery.deliveryMode,
                message: 'Enter the 6-digit admin verification code to unlock sensitive superadmin actions for this session.'
            };
        } catch (error) {
            await this.writeFailureAudit({
                actorId,
                actorRole,
                targetId: challengeState.challengeId,
                metadata: {
                    purpose: STEP_UP_PURPOSE,
                    reasonCode: 'DELIVERY_FAILED'
                },
                ipAddress: context.ipAddress,
                reason: 'Admin step-up code was generated but email delivery failed.'
            });

            throw error;
        }
    }

    async verifyChallenge(
        actorId: number,
        actorRole: string,
        input: AdminStepUpVerifyInput,
        context: AdminRequestContext = {}
    ): Promise<AdminStepUpVerifyResponse> {
        this.assertSuperadmin(actorRole);

        const sessionId = this.requireSessionId(context);

        const result = await this.runTransaction(async (tx: AdminTx) => {
            await this.getActiveSessionTx(tx, actorId, sessionId);

            const challenge = await tx.adminStepUpChallenge.findUnique({
                where: { id: input.challengeId }
            });

            if (
                !challenge ||
                challenge.actorId !== actorId ||
                challenge.sessionId !== sessionId ||
                challenge.purpose !== STEP_UP_PURPOSE
            ) {
                throw new AppError(
                    'That admin verification challenge does not belong to this session. Request a fresh code and try again.',
                    400,
                    'ADMIN_STEP_UP_CHALLENGE_INVALID'
                );
            }

            if (
                challenge.failedAttempts >= ADMIN_CONFIG.STEP_UP_MAX_FAILED_ATTEMPTS
            ) {
                return {
                    ok: false as const,
                    challengeId: challenge.id,
                    code: 'ADMIN_STEP_UP_LOCKED',
                    statusCode: 403,
                    message: 'This admin verification challenge is locked. Request a new code to continue.',
                    reason: 'Admin step-up verification is locked after too many invalid OTP attempts.',
                    reasonCode: 'LOCKED'
                };
            }

            if (!challenge.otpHash || !challenge.otpExpiresAt || challenge.otpExpiresAt <= new Date()) {
                return {
                    ok: false as const,
                    challengeId: challenge.id,
                    code: 'ADMIN_STEP_UP_OTP_EXPIRED',
                    statusCode: 400,
                    message: 'That admin verification code has expired. Request a new code and try again.',
                    reason: 'Admin step-up verification expired before completion.',
                    reasonCode: 'EXPIRED_OTP'
                };
            }

            const isMatch = await verifyOtpHash(input.otp, challenge.otpHash);
            if (!isMatch) {
                const updatedChallenge = await tx.adminStepUpChallenge.update({
                    where: { id: challenge.id },
                    data: {
                        failedAttempts: { increment: 1 }
                    },
                    select: {
                        failedAttempts: true
                    }
                });

                return {
                    ok: false as const,
                    challengeId: challenge.id,
                    code: updatedChallenge.failedAttempts >= ADMIN_CONFIG.STEP_UP_MAX_FAILED_ATTEMPTS
                        ? 'ADMIN_STEP_UP_LOCKED'
                        : 'ADMIN_STEP_UP_INVALID_OTP',
                    statusCode: 400,
                    message: updatedChallenge.failedAttempts >= ADMIN_CONFIG.STEP_UP_MAX_FAILED_ATTEMPTS
                        ? 'The admin verification code was incorrect too many times. Request a new code to continue.'
                        : 'That admin verification code is not correct.',
                    reason: 'Admin step-up verification failed because the OTP was incorrect.',
                    reasonCode: 'INVALID_OTP',
                    failedAttempts: updatedChallenge.failedAttempts
                };
            }

            const stepUpToken = randomBytes(32).toString('hex');
            const tokenHash = await hashOtp(stepUpToken);
            const tokenExpiresAt = new Date(Date.now() + ADMIN_CONFIG.STEP_UP_TOKEN_TTL_MS);

            await tx.adminStepUpChallenge.update({
                where: { id: challenge.id },
                data: {
                    otpHash: null,
                    otpExpiresAt: null,
                    verifiedTokenHash: tokenHash,
                    verifiedTokenExpiresAt: tokenExpiresAt,
                    verifiedAt: new Date(),
                    failedAttempts: 0,
                    lastUsedAt: new Date()
                }
            });

            await this.writeAdminAuditTx(tx, {
                actorId,
                actorRole,
                action: 'STEP_UP_CHALLENGE_VERIFIED',
                targetId: challenge.id,
                metadata: {
                    purpose: STEP_UP_PURPOSE,
                    sessionId
                },
                ipAddress: context.ipAddress
            });

            return {
                ok: true as const,
                purpose: 'SUPERADMIN_SENSITIVE_ACTION' as const,
                stepUpToken,
                expiresAt: tokenExpiresAt.toISOString(),
                message: 'Admin step-up verified. You can now perform sensitive superadmin actions for a short time on this session.'
            };
        });

        if (!result.ok) {
            await this.writeFailureAudit({
                actorId,
                actorRole,
                targetId: result.challengeId,
                metadata: {
                    purpose: STEP_UP_PURPOSE,
                    reasonCode: result.reasonCode,
                    failedAttempts: result.failedAttempts ?? null
                },
                ipAddress: context.ipAddress,
                reason: result.reason
            });

            throw new AppError(result.message, result.statusCode, result.code);
        }

        return {
            purpose: result.purpose,
            stepUpToken: result.stepUpToken,
            expiresAt: result.expiresAt,
            message: result.message
        };
    }

    async assertVerifiedForSensitiveActionTx(
        tx: AdminTx,
        actorId: number,
        actorRole: string,
        context: AdminRequestContext,
        attemptedAction: string,
        targetId?: string
    ): Promise<{ challengeId: string; expiresAt: Date }> {
        this.assertSuperadmin(actorRole);

        const sessionId = this.requireSessionId(context);
        if (!context.stepUpToken) {
            throw new AppError(
                'This action needs superadmin step-up approval. Request and verify an admin step-up code first.',
                403,
                'ADMIN_STEP_UP_REQUIRED'
            );
        }

        await this.getActiveSessionTx(tx, actorId, sessionId);

        const challenge = await tx.adminStepUpChallenge.findUnique({
            where: {
                actorId_sessionId_purpose: {
                    actorId,
                    sessionId,
                    purpose: STEP_UP_PURPOSE
                }
            }
        });

        if (
            !challenge ||
            !challenge.verifiedTokenHash ||
            !challenge.verifiedTokenExpiresAt ||
            challenge.verifiedTokenExpiresAt <= new Date()
        ) {
            throw new AppError(
                'Your superadmin approval expired. Request a fresh admin step-up code and try again.',
                403,
                'ADMIN_STEP_UP_REQUIRED'
            );
        }

        const isMatch = await verifyOtpHash(context.stepUpToken, challenge.verifiedTokenHash);
        if (!isMatch) {
            await this.writeFailureAudit({
                actorId,
                actorRole,
                targetId: challenge.id,
                metadata: {
                    purpose: STEP_UP_PURPOSE,
                    attemptedAction,
                    attemptedTargetId: targetId || null,
                    reasonCode: 'INVALID_STEP_UP_TOKEN'
                },
                ipAddress: context.ipAddress,
                reason: 'Sensitive admin action attempted with an invalid step-up token.'
            });

            throw new AppError(
                'The superadmin approval token is invalid for this session. Request a new admin step-up code and try again.',
                403,
                'ADMIN_STEP_UP_INVALID_TOKEN'
            );
        }

        await tx.adminStepUpChallenge.update({
            where: { id: challenge.id },
            data: {
                lastUsedAt: new Date()
            }
        });

        return {
            challengeId: challenge.id,
            expiresAt: challenge.verifiedTokenExpiresAt
        };
    }
}

export const adminStepUpService = new AdminStepUpService();
