import { AuditAction, DeviceRegistrationMethod, ExamStatus, Prisma } from '@prisma/client';
import prisma from '../../config/database';
import { AUTH_CONFIG } from '../../config/constants';
import { buildAchievementViews, UserAchievementView } from '../../shared/achievements/service';
import { assertPasswordChangeAllowed } from '../../shared/auth/passwordPolicy';
import { AuthError } from '../../shared/errors/AuthError';
import { hashPassword, verifyPassword } from '../../shared/utils/hash';
import { AppError } from '../../shared/errors/AppError';
import { ForbiddenError } from '../../shared/errors/ForbiddenError';
import { NotFoundError } from '../../shared/errors/NotFoundError';
import { ResolvedInstitutionContext, institutionContextService } from '../../shared/institutions/context';
import { deriveStreakSnapshot } from '../../shared/streaks/domain';
import { UpdateProfileInput } from './users.schema';

const userProfileSelect = {
  id: true,
  email: true,
  fullName: true,
  isVerified: true,
  role: true,
  aspiringCourse: true,
  targetScore: true,
  isPremium: true,
  subscriptionEndDate: true,
  deviceAccessMode: true,
  emailUnsubscribed: true,
  createdAt: true,
  updatedAt: true
} satisfies Prisma.UserSelect;

const userStatsBaseSelect = {
  currentStreak: true,
  longestStreak: true,
  lastActivityDate: true,
  streakFreezesAvailable: true,
  hasTakenFreeExam: true,
  aiExplanationsUsedToday: true,
  isPremium: true,
  deviceAccessMode: true
} satisfies Prisma.UserSelect;

type UserProfile = Prisma.UserGetPayload<{ select: typeof userProfileSelect }>;
type UserStatsBase = Prisma.UserGetPayload<{ select: typeof userStatsBaseSelect }>;
type UserStatsResponse = Omit<UserStatsBase, 'lastActivityDate'> & {
  institution: ResolvedInstitutionContext;
  totalSp: number;
  weeklySp: number;
  realExamsCompleted: number;
  completedCollaborationExams: number;
  completedExams: number;
  abandonedExams: number;
  inProgressExams: number;
  bookmarkedQuestions: number;
  activeSessions: number;
  registeredPremiumDevices: number;
};
type SecuritySessionRow = Prisma.UserSessionGetPayload<{
  select: {
    id: true;
    deviceId: true;
    createdAt: true;
    expiresAt: true;
  };
}>;
type SecurityDeviceRow = Prisma.UserDeviceGetPayload<{
  select: {
    deviceId: true;
    deviceName: true;
    userAgent: true;
    createdAt: true;
    verifiedAt: true;
    lastLoginAt: true;
    isActive: true;
    registrationMethod: true;
  };
}>;

type SecurityOverview = {
  deviceAccessMode: 'FREE' | 'PREMIUM';
  currentSessionId: string;
  currentDeviceId: string;
  activeSessions: Array<{
    sessionId: string;
    deviceId: string;
    deviceName: string | null;
    userAgent: string | null;
    createdAt: Date;
    expiresAt: Date | null;
    lastLoginAt: Date | null;
    isCurrent: boolean;
    isRegisteredPremiumDevice: boolean;
    registrationMethod: DeviceRegistrationMethod | null;
  }>;
  registeredPremiumDevices: Array<{
    deviceId: string;
    deviceName: string;
    userAgent: string;
    createdAt: Date;
    verifiedAt: Date | null;
    lastLoginAt: Date | null;
    isCurrent: boolean;
    isActive: boolean;
    registrationMethod: DeviceRegistrationMethod | null;
  }>;
};

export class UsersService {
  private runTransaction<T>(operation: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    return prisma.$transaction(operation, {
      maxWait: AUTH_CONFIG.TX_MAX_WAIT_MS,
      timeout: AUTH_CONFIG.TX_TIMEOUT_MS
    });
  }

  private async resolveStatsInstitution(
    userId: number,
    institutionCode?: string | null
  ): Promise<ResolvedInstitutionContext> {
    return institutionContextService.resolveForUser(userId, institutionCode);
  }

  async getProfile(userId: number): Promise<UserProfile> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: userProfileSelect
    });

    if (!user) {
      throw new NotFoundError('User not found.');
    }

    return user;
  }

  async updateProfile(userId: number, data: UpdateProfileInput): Promise<UserProfile> {
    const existingUser = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true }
    });

    if (!existingUser) {
      throw new NotFoundError('User not found.');
    }

    const updateData: Prisma.UserUpdateInput = {};

    if (data.fullName !== undefined) updateData.fullName = data.fullName;
    if (data.aspiringCourse !== undefined) updateData.aspiringCourse = data.aspiringCourse;
    if (data.targetScore !== undefined) updateData.targetScore = data.targetScore;
    if (data.emailUnsubscribed !== undefined) updateData.emailUnsubscribed = data.emailUnsubscribed;

    return prisma.user.update({
      where: { id: userId },
      data: updateData,
      select: userProfileSelect
    });
  }

  async getStats(userId: number, institutionCode?: string | null): Promise<UserStatsResponse> {
    const institution = await this.resolveStatsInstitution(userId, institutionCode);

    const [user, scopedStats] = await Promise.all([
      prisma.user.findUnique({
        where: { id: userId },
        select: userStatsBaseSelect
      }),
      prisma.userInstitutionStats.findUnique({
        where: {
          userId_institutionId: {
            userId,
            institutionId: institution.id
          }
        },
        select: {
          totalSp: true,
          weeklySp: true,
          realExamsCompleted: true,
          completedCollaborationExams: true
        }
      })
    ]);

    if (!user) {
      throw new NotFoundError('User not found.');
    }

    const [
      completedExams,
      abandonedExams,
      inProgressExams,
      bookmarkedQuestions,
      activeSessions,
      registeredPremiumDevices
    ] = await Promise.all([
      prisma.exam.count({
        where: {
          userId,
          institutionId: institution.id,
          status: ExamStatus.COMPLETED
        }
      }),
      prisma.exam.count({
        where: {
          userId,
          institutionId: institution.id,
          status: ExamStatus.ABANDONED
        }
      }),
      prisma.exam.count({
        where: {
          userId,
          institutionId: institution.id,
          status: ExamStatus.IN_PROGRESS
        }
      }),
      prisma.bookmarkedQuestion.count({
        where: {
          userId,
          question: {
            institutionId: institution.id
          },
          OR: [
            { expiresAt: null },
            { expiresAt: { gt: new Date() } }
          ]
        }
      }),
      prisma.userSession.count({
        where: {
          userId,
          isActive: true
        }
      }),
      prisma.userDevice.count({
        where: {
          userId,
          isVerified: true
        }
      })
    ]);

    const effectiveCurrentStreak = deriveStreakSnapshot(
      user.currentStreak,
      user.longestStreak,
      user.lastActivityDate ? new Date(user.lastActivityDate) : null,
      new Date(),
      user.streakFreezesAvailable
    ).currentStreak;

    const { lastActivityDate: _lastActivityDate, ...userStats } = user;

    return {
      institution,
      ...userStats,
      totalSp: scopedStats?.totalSp ?? 0,
      weeklySp: scopedStats?.weeklySp ?? 0,
      currentStreak: effectiveCurrentStreak,
      realExamsCompleted: scopedStats?.realExamsCompleted ?? 0,
      completedCollaborationExams: scopedStats?.completedCollaborationExams ?? 0,
      completedExams,
      abandonedExams,
      inProgressExams,
      bookmarkedQuestions,
      activeSessions,
      registeredPremiumDevices
    };
  }

  async getAchievements(userId: number): Promise<UserAchievementView[]> {
    const [user, unlockedAchievements] = await Promise.all([
      prisma.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          longestStreak: true,
          completedCollaborationExams: true
        }
      }),
      prisma.userAchievement.findMany({
        where: { userId },
        select: {
          key: true,
          unlockedAt: true
        },
        orderBy: [
          { unlockedAt: 'asc' },
          { id: 'asc' }
        ]
      })
    ]);

    if (!user) {
      throw new NotFoundError('User not found.');
    }

    return buildAchievementViews(unlockedAchievements, {
      STREAK_7_DAY_STARTER: user.longestStreak,
      COLLABORATION_30_COMPLETIONS: user.completedCollaborationExams
    });
  }

  async getSecurityOverview(
    userId: number,
    currentSessionId: string,
    currentDeviceId: string
  ): Promise<SecurityOverview> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        deviceAccessMode: true
      }
    });

    if (!user) {
      throw new NotFoundError('User not found.');
    }

    const [activeSessions, registeredDevices] = await Promise.all([
      prisma.userSession.findMany({
        where: {
          userId,
          isActive: true
        },
        select: {
          id: true,
          deviceId: true,
          createdAt: true,
          expiresAt: true
        },
        orderBy: [
          { createdAt: 'desc' },
          { id: 'desc' }
        ]
      }),
      prisma.userDevice.findMany({
        where: {
          userId,
          isVerified: true
        },
        select: {
          deviceId: true,
          deviceName: true,
          userAgent: true,
          createdAt: true,
          verifiedAt: true,
          lastLoginAt: true,
          isActive: true,
          registrationMethod: true
        },
        orderBy: [
          { lastLoginAt: 'desc' },
          { createdAt: 'desc' }
        ]
      })
    ]);

    const registeredDeviceById = new Map<string, SecurityDeviceRow>(
      registeredDevices.map((device: SecurityDeviceRow) => [device.deviceId, device])
    );

    return {
      deviceAccessMode: user.deviceAccessMode,
      currentSessionId,
      currentDeviceId,
      activeSessions: activeSessions.map((session: SecuritySessionRow) => {
        const device = registeredDeviceById.get(session.deviceId);

        return {
          sessionId: session.id,
          deviceId: session.deviceId,
          deviceName: device?.deviceName ?? null,
          userAgent: device?.userAgent ?? null,
          createdAt: session.createdAt,
          expiresAt: session.expiresAt ?? null,
          lastLoginAt: device?.lastLoginAt ?? null,
          isCurrent: session.id === currentSessionId,
          isRegisteredPremiumDevice: Boolean(device),
          registrationMethod: device?.registrationMethod ?? null
        };
      }),
      registeredPremiumDevices: registeredDevices.map((device: SecurityDeviceRow) => ({
        deviceId: device.deviceId,
        deviceName: device.deviceName,
        userAgent: device.userAgent,
        createdAt: device.createdAt,
        verifiedAt: device.verifiedAt ?? null,
        lastLoginAt: device.lastLoginAt ?? null,
        isCurrent: device.deviceId === currentDeviceId,
        isActive: device.isActive,
        registrationMethod: device.registrationMethod ?? null
      }))
    };
  }

  async changePassword(
    userId: number,
    currentPassword: string,
    newPassword: string,
    currentSessionId: string,
    currentDeviceId: string,
    context: {
      ipAddress?: string;
      userAgent?: string;
    } = {}
  ): Promise<{
    success: true;
    message: string;
    changedAt: string;
    invalidatedSessions: number;
  }> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        passwordHash: true
      }
    });

    if (!user) {
      throw new NotFoundError('User not found.');
    }

    const currentPasswordMatches = await verifyPassword(currentPassword, user.passwordHash);
    if (!currentPasswordMatches) {
      throw new AppError('Your current password is not correct.', 400, 'PASSWORD_INVALID');
    }

    const passwordReuse = await verifyPassword(newPassword, user.passwordHash);
    if (passwordReuse) {
      throw new AppError('Your new password must be different from your current password.', 400, 'PASSWORD_REUSE');
    }

    const nextPasswordHash = await hashPassword(newPassword);
    const changedAt = new Date();

    const invalidatedSessions = await this.runTransaction(async (tx) => {
      const currentSession = await tx.userSession.findFirst({
        where: {
          id: currentSessionId,
          userId,
          isActive: true
        },
        select: {
          id: true,
          deviceId: true
        }
      });

      if (!currentSession) {
        throw new AuthError('Your session is no longer active. Please log in again.', 401, 'SESSION_INVALID');
      }

      await assertPasswordChangeAllowed(tx, userId, changedAt);

      await tx.user.update({
        where: { id: userId },
        data: {
          passwordHash: nextPasswordHash,
          lastPasswordChange: changedAt,
          passwordResetToken: null,
          passwordResetExpires: null
        }
      });

      const invalidated = await tx.userSession.updateMany({
        where: {
          userId,
          isActive: true,
          NOT: {
            id: currentSession.id
          }
        },
        data: {
          isActive: false
        }
      });

      await tx.auditLog.create({
        data: {
          userId,
          action: AuditAction.PASSWORD_CHANGED,
          deviceId: currentDeviceId,
          ipAddress: context.ipAddress,
          userAgent: context.userAgent,
          metadata: {
            currentSessionId: currentSession.id,
            invalidatedSessions: invalidated.count
          }
        }
      });

      return invalidated.count;
    });

    return {
      success: true,
      message: invalidatedSessions > 0
        ? 'Your password was changed successfully. Other active sessions were signed out.'
        : 'Your password was changed successfully.',
      changedAt: changedAt.toISOString(),
      invalidatedSessions
    };
  }

  async deleteAccount(userId: number, password: string): Promise<{
    success: true;
    message: string;
    deletedAt: string;
  }> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        role: true,
        email: true,
        passwordHash: true
      }
    });

    if (!user) {
      throw new NotFoundError('User not found.');
    }

    if (user.role !== 'USER') {
      throw new ForbiddenError('Admin and superadmin accounts cannot be deleted from the self-service user settings flow.');
    }

    const [adminAuditCount, entitlementAuthorityCount] = await Promise.all([
      prisma.adminAuditLog.count({
        where: { actorId: userId }
      }),
      prisma.premiumEntitlement.count({
        where: {
          OR: [
            { grantedByAdminId: userId },
            { revokedByAdminId: userId }
          ]
        }
      })
    ]);

    if (adminAuditCount > 0 || entitlementAuthorityCount > 0) {
      throw new ForbiddenError('This account has administrative history and must be retired through an internal support workflow.');
    }

    const passwordMatches = await verifyPassword(password, user.passwordHash);
    if (!passwordMatches) {
      throw new AppError('Your current password is not correct.', 400, 'PASSWORD_INVALID');
    }

    const deletedAt = new Date();

    await this.runTransaction(async (tx) => {
      const hostedSessions = await tx.collaborationSession.findMany({
        where: { hostUserId: userId },
        select: { id: true }
      });
      const hostedSessionIds = hostedSessions.map((session) => session.id);

      if (hostedSessionIds.length > 0) {
        await tx.exam.updateMany({
          where: {
            collaborationSessionId: {
              in: hostedSessionIds
            }
          },
          data: {
            collaborationSessionId: null
          }
        });

        await tx.sessionParticipant.deleteMany({
          where: {
            sessionId: {
              in: hostedSessionIds
            }
          }
        });

        await tx.collaborationSession.deleteMany({
          where: {
            id: {
              in: hostedSessionIds
            }
          }
        });
      }

      await tx.sessionParticipant.deleteMany({
        where: { userId }
      });

      await tx.questionReport.deleteMany({
        where: { userId }
      });

      await tx.user.delete({
        where: { id: userId }
      });
    });

    return {
      success: true,
      message: 'Your account and personal study data were deleted successfully.',
      deletedAt: deletedAt.toISOString()
    };
  }
}

export const usersService = new UsersService();
