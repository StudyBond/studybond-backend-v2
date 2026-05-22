import {
  Institution,
  NotificationAnnouncementAudience,
  NotificationCategory,
  NotificationKind,
  NotificationPriority,
  NotificationAnnouncement,
  NotificationAnnouncementReceipt,
  Prisma,
  UserNotification,
} from "@prisma/client";
import prisma from "../../config/database";
import { AUTH_CONFIG, NOTIFICATIONS_CONFIG } from "../../config/constants";
import { adminStepUpService } from "../admin/admin-step-up.service";
import {
  buildRouteKey,
  idempotencyService,
  type IdempotencyContext,
  resolveIdempotencyKey,
} from "../../shared/idempotency/idempotency";
import { AppError } from "../../shared/errors/AppError";
import { ForbiddenError } from "../../shared/errors/ForbiddenError";
import { NotFoundError } from "../../shared/errors/NotFoundError";
import {
  deriveStreakSnapshot,
  getLagosDateKey,
  getLagosDayEnd,
} from "../../shared/streaks/domain";
import {
  CATEGORY_TO_PREFERENCE_KEY,
  KIND_TO_CATEGORY,
  KIND_TO_DEFAULT_PRIORITY,
  mergeNotificationPreferences,
  resolveNotificationPreferences,
} from "./notifications.constants";
import { notificationsRealtimeHub } from "./notifications.realtime";
import type {
  AdminAnnouncementCreateInput,
  AdminAnnouncementsQuery,
  NotificationActivityQuery,
  NotificationAnnouncementsQuery,
  NotificationPreferencesPatch,
  NotificationSummaryQuery,
} from "./notifications.schema";

type NotificationTx = Prisma.TransactionClient;

type AudienceUser = {
  id: number;
  isPremium: boolean;
  isVerified: boolean;
  targetInstitutionId: number | null;
  notificationPreferences: unknown;
};

type AdminRequestContext = {
  idempotencyKey?: string;
  stepUpToken?: string;
  sessionId?: string;
  ipAddress?: string;
};

export interface SerializedActivityNotification {
  id: string;
  kind: NotificationKind;
  category: NotificationCategory;
  priority: NotificationPriority;
  title: string;
  body: string;
  deeplink: string | null;
  payload: unknown;
  sourceType: string;
  sourceId: string | null;
  availableAt: string;
  expiresAt: string | null;
  readAt: string | null;
  dismissedAt: string | null;
  createdAt: string;
  updatedAt: string;
  isRead: boolean;
  isDismissed: boolean;
}

export interface SerializedAnnouncementNotification {
  id: string;
  title: string;
  body: string;
  deeplink: string | null;
  priority: NotificationPriority;
  audience: NotificationAnnouncementAudience;
  institutionId: number | null;
  institutionCode: string | null;
  institutionName: string | null;
  verifiedOnly: boolean;
  startAt: string;
  expiresAt: string | null;
  createdAt: string;
  isRead: boolean;
  isDismissed: boolean;
  readAt: string | null;
  dismissedAt: string | null;
}

export interface NotificationSummaryCounts {
  unreadActivityCount: number;
  unreadAnnouncementCount: number;
  totalUnreadCount: number;
}

export interface CreatedActivityNotificationEvent {
  userId: number;
  notification: SerializedActivityNotification;
}

interface CreateActivityNotificationInput {
  userId: number;
  kind: NotificationKind;
  title: string;
  body: string;
  deeplink?: string | null;
  payload?: Prisma.InputJsonValue | null;
  dedupKey: string;
  sourceType: string;
  sourceId?: string | null;
  availableAt?: Date;
  expiresAt?: Date | null;
  category?: NotificationCategory;
  priority?: NotificationPriority;
  ignorePreferences?: boolean;
}

type UserAnnouncementRecord = NotificationAnnouncement & {
  institution: Pick<Institution, "id" | "code" | "name"> | null;
  receipts: NotificationAnnouncementReceipt[];
};

type AdminAnnouncementRecord = NotificationAnnouncement & {
  institution: Pick<Institution, "id" | "code" | "name"> | null;
};

function toDigitString(value: bigint): string {
  return value.toString();
}

function toBigIntId(value: string, label: string): bigint {
  try {
    return BigInt(value);
  } catch {
    throw new AppError(`Invalid ${label}.`, 400, "INVALID_NOTIFICATION_ID");
  }
}

function buildPagination(page: number, limit: number, total: number) {
  return {
    page,
    limit,
    total,
    totalPages: Math.max(1, Math.ceil(total / limit)),
  };
}

export class NotificationsService {
  private assertReadEnabled(skipGuard = false): void {
    if (!skipGuard && !NOTIFICATIONS_CONFIG.READ_ENABLED) {
      throw new AppError(
        "Notifications are not enabled yet.",
        404,
        "NOTIFICATIONS_READ_DISABLED"
      );
    }
  }

  assertWsEnabled(): void {
    if (!NOTIFICATIONS_CONFIG.WS_ENABLED) {
      throw new AppError(
        "Realtime notifications are not enabled yet.",
        404,
        "NOTIFICATIONS_WS_DISABLED"
      );
    }
  }

  private assertAdminAnnouncementsEnabled(): void {
    if (!NOTIFICATIONS_CONFIG.ADMIN_ANNOUNCEMENTS_ENABLED) {
      throw new AppError(
        "Admin announcements are not enabled yet.",
        404,
        "NOTIFICATIONS_ADMIN_DISABLED"
      );
    }
  }

  private buildAdminMutationContext(
    actorId: number,
    routeKey: string,
    idempotencyKey: string | undefined,
    payload: unknown
  ): IdempotencyContext {
    return {
      userId: actorId,
      routeKey,
      idempotencyKey: resolveIdempotencyKey(
        idempotencyKey,
        routeKey.replace(/\s+/g, "_").toLowerCase()
      ),
      payload,
      ttlSeconds: 86_400,
    };
  }

  private async runTransaction<T>(
    operation: (tx: NotificationTx) => Promise<T>
  ): Promise<T> {
    return prisma.$transaction(operation, {
      maxWait: AUTH_CONFIG.TX_MAX_WAIT_MS,
      timeout: AUTH_CONFIG.TX_TIMEOUT_MS,
    });
  }

  private async loadAudienceUser(
    userId: number,
    tx: NotificationTx | typeof prisma = prisma
  ): Promise<AudienceUser> {
    const user = await tx.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        isPremium: true,
        isVerified: true,
        targetInstitutionId: true,
        notificationPreferences: true,
      },
    });

    if (!user) {
      throw new NotFoundError("User not found.");
    }

    return user;
  }

  private buildVisibleAnnouncementsWhere(
    user: AudienceUser,
    now = new Date()
  ): Prisma.NotificationAnnouncementWhereInput {
    const audienceFilter =
      user.isPremium
        ? {
            in: [
              NotificationAnnouncementAudience.ALL,
              NotificationAnnouncementAudience.PREMIUM,
            ],
          }
        : {
            in: [
              NotificationAnnouncementAudience.ALL,
              NotificationAnnouncementAudience.FREE,
            ],
          };

    return {
      cancelledAt: null,
      startAt: {
        lte: now,
      },
      AND: [
        {
          OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
        },
        {
          targetAudience: audienceFilter,
        },
        ...(user.isVerified ? [] : [{ verifiedOnly: false }]),
        ...(user.targetInstitutionId
          ? [
              {
                OR: [
                  { institutionId: null },
                  { institutionId: user.targetInstitutionId },
                ],
              },
            ]
          : [{ institutionId: null }]),
      ],
    };
  }

  private buildActivityWhere(
    userId: number,
    now = new Date(),
    query?: Pick<NotificationActivityQuery, "state" | "category">
  ): Prisma.UserNotificationWhereInput {
    return {
      userId,
      dismissedAt: null,
      availableAt: { lte: now },
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      ...(query?.state === "unread" ? { readAt: null } : {}),
      ...(query?.category ? { category: query.category } : {}),
    };
  }

  private buildUnreadVisibleAnnouncementsWhere(
    user: AudienceUser,
    now = new Date()
  ): Prisma.NotificationAnnouncementWhereInput {
    return {
      ...this.buildVisibleAnnouncementsWhere(user, now),
      NOT: {
        receipts: {
          some: {
            userId: user.id,
            OR: [{ readAt: { not: null } }, { dismissedAt: { not: null } }],
          },
        },
      },
    };
  }

  private serializeActivity(
    notification: UserNotification
  ): SerializedActivityNotification {
    return {
      id: toDigitString(notification.id),
      kind: notification.kind,
      category: notification.category,
      priority: notification.priority,
      title: notification.title,
      body: notification.body,
      deeplink: notification.deeplink ?? null,
      payload: notification.payload ?? null,
      sourceType: notification.sourceType,
      sourceId: notification.sourceId ?? null,
      availableAt: notification.availableAt.toISOString(),
      expiresAt: notification.expiresAt?.toISOString() ?? null,
      readAt: notification.readAt?.toISOString() ?? null,
      dismissedAt: notification.dismissedAt?.toISOString() ?? null,
      createdAt: notification.createdAt.toISOString(),
      updatedAt: notification.updatedAt.toISOString(),
      isRead: Boolean(notification.readAt),
      isDismissed: Boolean(notification.dismissedAt),
    };
  }

  private serializeUserAnnouncement(
    announcement: UserAnnouncementRecord,
    userId: number
  ): SerializedAnnouncementNotification {
    const receipt = announcement.receipts.find(
      (entry: NotificationAnnouncementReceipt) => entry.userId === userId
    );

    return {
      id: announcement.id.toString(),
      title: announcement.title,
      body: announcement.body,
      deeplink: announcement.deeplink ?? null,
      priority: announcement.priority,
      audience: announcement.targetAudience,
      institutionId: announcement.institutionId ?? null,
      institutionCode: announcement.institution?.code ?? null,
      institutionName: announcement.institution?.name ?? null,
      verifiedOnly: announcement.verifiedOnly,
      startAt: announcement.startAt.toISOString(),
      expiresAt: announcement.expiresAt?.toISOString() ?? null,
      createdAt: announcement.createdAt.toISOString(),
      isRead: Boolean(receipt?.readAt),
      isDismissed: Boolean(receipt?.dismissedAt),
      readAt: receipt?.readAt?.toISOString() ?? null,
      dismissedAt: receipt?.dismissedAt?.toISOString() ?? null,
    };
  }

  private serializeAdminAnnouncement(
    announcement: AdminAnnouncementRecord
  ) {
    return {
      id: announcement.id.toString(),
      title: announcement.title,
      body: announcement.body,
      deeplink: announcement.deeplink ?? null,
      priority: announcement.priority,
      targetAudience: announcement.targetAudience,
      institutionId: announcement.institutionId ?? null,
      institutionCode: announcement.institution?.code ?? null,
      institutionName: announcement.institution?.name ?? null,
      verifiedOnly: announcement.verifiedOnly,
      startAt: announcement.startAt.toISOString(),
      expiresAt: announcement.expiresAt?.toISOString() ?? null,
      cancelledAt: announcement.cancelledAt?.toISOString() ?? null,
      createdAt: announcement.createdAt.toISOString(),
      updatedAt: announcement.updatedAt.toISOString(),
      createdByAdminId: announcement.createdByAdminId,
    };
  }

  private async getSummaryCountsForUser(
    user: AudienceUser,
    now = new Date()
  ): Promise<NotificationSummaryCounts> {
    const [unreadActivityCount, unreadAnnouncementCount] = await Promise.all([
      prisma.userNotification.count({
        where: this.buildActivityWhere(user.id, now, { state: "unread" }),
      }),
      prisma.notificationAnnouncement.count({
        where: this.buildUnreadVisibleAnnouncementsWhere(user, now),
      }),
    ]);

    return {
      unreadActivityCount,
      unreadAnnouncementCount,
      totalUnreadCount: unreadActivityCount + unreadAnnouncementCount,
    };
  }

  async getSummary(
    userId: number,
    query: NotificationSummaryQuery = {},
    options: { skipReadGuard?: boolean } = {}
  ) {
    this.assertReadEnabled(options.skipReadGuard);
    const user = await this.loadAudienceUser(userId);
    const now = new Date();
    const recentLimit = query.recentLimit ?? NOTIFICATIONS_CONFIG.RECENT_ACTIVITY_LIMIT;
    const counts = await this.getSummaryCountsForUser(user, now);

    const [recentActivity, activeAnnouncements] = await Promise.all([
      prisma.userNotification.findMany({
        where: this.buildActivityWhere(userId, now),
        orderBy: [{ priority: "desc" }, { createdAt: "desc" }, { id: "desc" }],
        take: recentLimit,
      }),
      prisma.notificationAnnouncement.findMany({
        where: this.buildUnreadVisibleAnnouncementsWhere(user, now),
        include: {
          institution: {
            select: {
              id: true,
              code: true,
              name: true,
            },
          },
          receipts: {
            where: { userId },
          },
        },
        orderBy: [{ priority: "desc" }, { startAt: "desc" }, { id: "desc" }],
        take: 3,
      }),
    ]);

    return {
      counts,
      recentActivity: recentActivity.map((item: UserNotification) => this.serializeActivity(item)),
      activeAnnouncements: activeAnnouncements.map((item: UserAnnouncementRecord) =>
        this.serializeUserAnnouncement(item, userId)
      ),
      preferences: resolveNotificationPreferences(user.notificationPreferences),
    };
  }

  async getActivity(userId: number, query: NotificationActivityQuery) {
    this.assertReadEnabled();
    const now = new Date();
    const where = this.buildActivityWhere(userId, now, query);
    const skip = (query.page - 1) * query.limit;
    const user = await this.loadAudienceUser(userId);

    const [items, total, counts] = await Promise.all([
      prisma.userNotification.findMany({
        where,
        orderBy: [{ priority: "desc" }, { createdAt: "desc" }, { id: "desc" }],
        skip,
        take: query.limit,
      }),
      prisma.userNotification.count({ where }),
      this.getSummaryCountsForUser(user, now),
    ]);

    return {
      items: items.map((item: UserNotification) => this.serializeActivity(item)),
      pagination: buildPagination(query.page, query.limit, total),
      counts,
    };
  }

  async getAnnouncements(userId: number, query: NotificationAnnouncementsQuery) {
    this.assertReadEnabled();
    const user = await this.loadAudienceUser(userId);
    const now = new Date();
    const skip = (query.page - 1) * query.limit;
    const baseWhere =
      query.state === "unread"
        ? this.buildUnreadVisibleAnnouncementsWhere(user, now)
        : this.buildVisibleAnnouncementsWhere(user, now);

    const [items, total, counts] = await Promise.all([
      prisma.notificationAnnouncement.findMany({
        where: baseWhere,
        include: {
          institution: {
            select: {
              id: true,
              code: true,
              name: true,
            },
          },
          receipts: {
            where: { userId },
          },
        },
        orderBy: [{ priority: "desc" }, { startAt: "desc" }, { id: "desc" }],
        skip,
        take: query.limit,
      }),
      prisma.notificationAnnouncement.count({ where: baseWhere }),
      this.getSummaryCountsForUser(user, now),
    ]);

    return {
      items: items.map((item: UserAnnouncementRecord) => this.serializeUserAnnouncement(item, userId)),
      pagination: buildPagination(query.page, query.limit, total),
      counts,
    };
  }

  async getPreferences(userId: number) {
    this.assertReadEnabled();
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { notificationPreferences: true },
    });

    if (!user) {
      throw new NotFoundError("User not found.");
    }

    return {
      preferences: resolveNotificationPreferences(user.notificationPreferences),
    };
  }

  async updatePreferences(userId: number, patch: NotificationPreferencesPatch) {
    this.assertReadEnabled();
    const updated = await prisma.user.update({
      where: { id: userId },
      data: {
        notificationPreferences: mergeNotificationPreferences(
          (
            await prisma.user.findUnique({
              where: { id: userId },
              select: { notificationPreferences: true },
            })
          )?.notificationPreferences,
          patch
        ) as unknown as Prisma.InputJsonValue,
      },
      select: {
        notificationPreferences: true,
      },
    });

    return {
      preferences: resolveNotificationPreferences(updated.notificationPreferences),
    };
  }

  async markActivityRead(userId: number, notificationId: string) {
    this.assertReadEnabled();
    const id = toBigIntId(notificationId, "notification id");
    const existing = await prisma.userNotification.findFirst({
      where: {
        id,
        userId,
      },
    });

    if (!existing) {
      throw new NotFoundError("Notification not found.");
    }

    const updated =
      existing.readAt
        ? existing
        : await prisma.userNotification.update({
            where: { id },
            data: {
              readAt: new Date(),
            },
          });

    const notification = this.serializeActivity(updated);
    const counts = await this.publishActivityUpdatedAndSummary(userId, notification);

    return { notification, counts };
  }

  async markAllActivityRead(userId: number) {
    this.assertReadEnabled();
    const now = new Date();
    const result = await prisma.userNotification.updateMany({
      where: {
        userId,
        readAt: null,
        dismissedAt: null,
        availableAt: { lte: now },
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      },
      data: {
        readAt: now,
      },
    });

    const summary = await this.getSummary(userId, {}, { skipReadGuard: true });
    this.publishSummaryPayload(userId, summary);

    return {
      updatedCount: result.count,
      counts: summary.counts,
    };
  }

  async dismissActivity(userId: number, notificationId: string) {
    this.assertReadEnabled();
    const id = toBigIntId(notificationId, "notification id");
    const existing = await prisma.userNotification.findFirst({
      where: {
        id,
        userId,
      },
    });

    if (!existing) {
      throw new NotFoundError("Notification not found.");
    }

    const updated =
      existing.dismissedAt
        ? existing
        : await prisma.userNotification.update({
            where: { id },
            data: {
              dismissedAt: new Date(),
              readAt: existing.readAt ?? new Date(),
            },
          });

    const notification = this.serializeActivity(updated);
    const counts = await this.publishActivityUpdatedAndSummary(userId, notification);

    return { notification, counts };
  }

  async markAnnouncementRead(userId: number, announcementId: string) {
    this.assertReadEnabled();
    const user = await this.loadAudienceUser(userId);
    const id = toBigIntId(announcementId, "announcement id");
    const announcement = await prisma.notificationAnnouncement.findFirst({
      where: {
        id,
        ...this.buildVisibleAnnouncementsWhere(user),
      },
      include: {
        institution: {
          select: { id: true, code: true, name: true },
        },
        receipts: {
          where: { userId },
        },
      },
    });

    if (!announcement) {
      throw new NotFoundError("Announcement not found.");
    }

    const existingReceipt = announcement.receipts.find(
      (entry: NotificationAnnouncementReceipt) => entry.userId === userId
    );
    const receipt =
      existingReceipt?.readAt
        ? existingReceipt
        : await prisma.notificationAnnouncementReceipt.upsert({
            where: {
              announcementId_userId: {
                announcementId: id,
                userId,
              },
            },
            update: {
              readAt: existingReceipt?.readAt ?? new Date(),
            },
            create: {
              announcementId: id,
              userId,
              readAt: new Date(),
            },
          });

    const payload = this.serializeUserAnnouncement(
      {
        ...(announcement as any),
        receipts: [receipt],
      },
      userId
    );
    const counts = await this.publishSummary(userId);

    return {
      announcement: payload,
      counts: counts.counts,
    };
  }

  async dismissAnnouncement(userId: number, announcementId: string) {
    this.assertReadEnabled();
    const user = await this.loadAudienceUser(userId);
    const id = toBigIntId(announcementId, "announcement id");
    const announcement = await prisma.notificationAnnouncement.findFirst({
      where: {
        id,
        ...this.buildVisibleAnnouncementsWhere(user),
      },
      include: {
        institution: {
          select: { id: true, code: true, name: true },
        },
        receipts: {
          where: { userId },
        },
      },
    });

    if (!announcement) {
      throw new NotFoundError("Announcement not found.");
    }

    const now = new Date();
    const receipt = await prisma.notificationAnnouncementReceipt.upsert({
      where: {
        announcementId_userId: {
          announcementId: id,
          userId,
        },
      },
      update: {
        dismissedAt: now,
        readAt: announcement.receipts[0]?.readAt ?? now,
      },
      create: {
        announcementId: id,
        userId,
        dismissedAt: now,
        readAt: now,
      },
    });

    const payload = this.serializeUserAnnouncement(
      {
        ...(announcement as any),
        receipts: [receipt],
      },
      userId
    );
    const counts = await this.publishSummary(userId);

    return {
      announcement: payload,
      counts: counts.counts,
    };
  }

  async createActivityNotificationTx(
    tx: NotificationTx,
    input: CreateActivityNotificationInput
  ): Promise<CreatedActivityNotificationEvent | null> {
    if (!NOTIFICATIONS_CONFIG.WRITE_ENABLED) {
      return null;
    }

    const category = input.category ?? KIND_TO_CATEGORY[input.kind];
    const priority = input.priority ?? KIND_TO_DEFAULT_PRIORITY[input.kind];
    const user = await tx.user.findUnique({
      where: { id: input.userId },
      select: {
        id: true,
        notificationPreferences: true,
      },
    });

    if (!user) {
      return null;
    }

    if (!input.ignorePreferences) {
      const preferences = resolveNotificationPreferences(user.notificationPreferences);
      const preferenceKey = CATEGORY_TO_PREFERENCE_KEY[category];
      if (!preferences[preferenceKey]) {
        return null;
      }
    }

    const existing = await tx.userNotification.findUnique({
      where: {
        userId_dedupKey: {
          userId: input.userId,
          dedupKey: input.dedupKey,
        },
      },
    });

    if (existing) {
      return null;
    }

    try {
      const created = await tx.userNotification.create({
        data: {
          userId: input.userId,
          kind: input.kind,
          category,
          priority,
          title: input.title,
          body: input.body,
          deeplink: input.deeplink ?? null,
          payload: input.payload ?? undefined,
          dedupKey: input.dedupKey,
          sourceType: input.sourceType,
          sourceId: input.sourceId ?? null,
          availableAt: input.availableAt ?? new Date(),
          expiresAt: input.expiresAt ?? null,
        },
      });

      return {
        userId: input.userId,
        notification: this.serializeActivity(created),
      };
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        return null;
      }
      throw error;
    }
  }

  async createActivityNotificationsTx(
    tx: NotificationTx,
    inputs: CreateActivityNotificationInput[]
  ): Promise<CreatedActivityNotificationEvent[]> {
    const events: CreatedActivityNotificationEvent[] = [];
    for (const input of inputs) {
      const event = await this.createActivityNotificationTx(tx, input);
      if (event) {
        events.push(event);
      }
    }
    return events;
  }

  async createActivityNotification(input: CreateActivityNotificationInput) {
    const event = await this.runTransaction((tx) =>
      this.createActivityNotificationTx(tx, input)
    );
    if (event) {
      await this.publishCreatedActivityEvents([event]);
    }
    return event;
  }

  async publishCreatedActivityEvents(
    events: CreatedActivityNotificationEvent[]
  ): Promise<void> {
    if (events.length === 0) return;

    const uniqueUsers = new Set<number>();
    for (const event of events) {
      notificationsRealtimeHub.publishActivityCreated(event.userId, event.notification);
      uniqueUsers.add(event.userId);
    }

    for (const userId of uniqueUsers) {
      await this.publishSummary(userId);
    }
  }

  private async publishActivityUpdatedAndSummary(
    userId: number,
    notification: SerializedActivityNotification
  ): Promise<NotificationSummaryCounts> {
    notificationsRealtimeHub.publishActivityUpdated(userId, notification);
    const summary = await this.publishSummary(userId);
    return summary.counts;
  }

  private publishSummaryPayload(userId: number, payload: unknown): void {
    if (!NOTIFICATIONS_CONFIG.WS_ENABLED) return;
    notificationsRealtimeHub.publishSummary(userId, payload);
  }

  async publishSummary(userId: number) {
    const summary = await this.getSummary(userId, {}, { skipReadGuard: true });
    this.publishSummaryPayload(userId, summary);
    return summary;
  }

  async createStreakRiskNotifications(now = new Date()) {
    if (!NOTIFICATIONS_CONFIG.WRITE_ENABLED) {
      return { candidates: 0, created: 0 };
    }

    const today = getLagosDateKey(now);
    const yesterdayDateKey = getLagosDateKey(new Date(now.getTime() - 24 * 60 * 60 * 1000));
    const users = await prisma.user.findMany({
      where: {
        isVerified: true,
        isBanned: false,
        currentStreak: { gt: 0 },
        OR: [
          { lastActivityDate: new Date(`${yesterdayDateKey}T00:00:00.000Z`) },
          {
            lastActivityDate: new Date(
              `${getLagosDateKey(new Date(now.getTime() - (2 * 24 * 60 * 60 * 1000)))}T00:00:00.000Z`
            ),
            streakFreezesAvailable: { gt: 0 },
          },
        ],
      },
      select: {
        id: true,
        currentStreak: true,
        longestStreak: true,
        lastActivityDate: true,
        streakFreezesAvailable: true,
      },
      take: NOTIFICATIONS_CONFIG.CLEANUP_BATCH_SIZE,
    });

    let created = 0;
    for (const user of users) {
      const snapshot = deriveStreakSnapshot(
        user.currentStreak,
        user.longestStreak,
        user.lastActivityDate ? new Date(user.lastActivityDate) : null,
        now,
        user.streakFreezesAvailable
      );

      if (snapshot.status !== "AT_RISK") {
        continue;
      }

      const event = await this.createActivityNotification({
        userId: user.id,
        kind: NotificationKind.STREAK_AT_RISK,
        title: `Protect your ${user.currentStreak}-day streak today`,
        body: snapshot.freezerProtectionActive
          ? "A quick exam before midnight will save your streak and preserve your freezer buffer."
          : "You still have time before midnight Lagos time to keep your momentum alive.",
        deeplink: "/dashboard",
        payload: {
          currentStreak: user.currentStreak,
          streakEndsAt: snapshot.streakEndsAt,
          freezerProtectionActive: snapshot.freezerProtectionActive,
        },
        dedupKey: `streak-at-risk:${today}`,
        sourceType: "STREAK_JOB",
        sourceId: today,
        expiresAt: getLagosDayEnd(now),
      });

      if (event) {
        created += 1;
      }
    }

    return {
      candidates: users.length,
      created,
    };
  }

  async cleanupExpiredActivityNotifications(now = new Date()) {
    const cutoff = new Date(
      now.getTime() - (NOTIFICATIONS_CONFIG.RETENTION_DAYS * 24 * 60 * 60 * 1000)
    );

    let deleted = 0;
    let batches = 0;

    while (true) {
      const stale = await prisma.userNotification.findMany({
        where: {
          createdAt: { lt: cutoff },
        },
        orderBy: { createdAt: "asc" },
        take: NOTIFICATIONS_CONFIG.CLEANUP_BATCH_SIZE,
        select: { id: true },
      });

      if (stale.length === 0) break;

      const result = await prisma.userNotification.deleteMany({
        where: {
          id: {
            in: stale.map((entry: { id: bigint }) => entry.id),
          },
        },
      });

      deleted += result.count;
      batches += 1;

      if (stale.length < NOTIFICATIONS_CONFIG.CLEANUP_BATCH_SIZE) {
        break;
      }
    }

    return {
      deleted,
      batches,
      retentionDays: NOTIFICATIONS_CONFIG.RETENTION_DAYS,
    };
  }

  async createAdminAnnouncement(
    actorId: number,
    actorRole: string,
    input: AdminAnnouncementCreateInput,
    context: AdminRequestContext = {}
  ) {
    this.assertAdminAnnouncementsEnabled();
    if (actorRole !== "SUPERADMIN") {
      throw new ForbiddenError("Superadmin access is required for this action.");
    }

    if (!context.sessionId) {
      throw new AppError(
        "Your admin session context is missing. Please sign in again.",
        401,
        "SESSION_INVALID"
      );
    }

    const routeKey = buildRouteKey("POST", "/api/admin/notifications/announcements");
    return idempotencyService.execute(
      this.buildAdminMutationContext(actorId, routeKey, context.idempotencyKey, input),
      async () =>
        this.runTransaction(async (tx) => {
          const stepUp = await adminStepUpService.assertVerifiedForSensitiveActionTx(
            tx,
            actorId,
            actorRole,
            context,
            "CREATE_NOTIFICATION_ANNOUNCEMENT",
            "announcement"
          );

          let institutionId: number | null = null;
          if (input.institutionCode) {
            const institution = await tx.institution.findUnique({
              where: { code: input.institutionCode.trim().toUpperCase() },
              select: { id: true },
            });
            if (!institution) {
              throw new NotFoundError("Institution not found.");
            }
            institutionId = institution.id;
          }

          const created = await tx.notificationAnnouncement.create({
            data: {
              title: input.title.trim(),
              body: input.body.trim(),
              deeplink: input.deeplink?.trim() || null,
              priority: input.priority,
              targetAudience: input.targetAudience,
              institutionId,
              verifiedOnly: input.verifiedOnly,
              startAt: new Date(input.startAt),
              expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
              createdByAdminId: actorId,
            },
            include: {
              institution: {
                select: { id: true, code: true, name: true },
              },
            },
          });

          await tx.adminAuditLog.create({
            data: {
              actorId,
              actorRole,
              action: "NOTIFICATION_ANNOUNCEMENT_CREATED",
              targetType: "SYSTEM",
              targetId: created.id.toString(),
              metadata: {
                stepUpChallengeId: stepUp.challengeId,
                targetAudience: created.targetAudience,
                institutionId: created.institutionId,
                verifiedOnly: created.verifiedOnly,
                startAt: created.startAt.toISOString(),
                expiresAt: created.expiresAt?.toISOString() ?? null,
              },
              reason: created.title,
              ipAddress: context.ipAddress,
            },
          });

          return {
            announcement: this.serializeAdminAnnouncement(created),
          };
        })
    );
  }

  async listAdminAnnouncements(
    _actorId: number,
    actorRole: string,
    query: AdminAnnouncementsQuery
  ) {
    this.assertAdminAnnouncementsEnabled();
    if (actorRole !== "SUPERADMIN") {
      throw new ForbiddenError("Superadmin access is required for this action.");
    }

    const now = new Date();
    const skip = (query.page - 1) * query.limit;

    const where: Prisma.NotificationAnnouncementWhereInput = (() => {
      switch (query.status) {
        case "scheduled":
          return {
            cancelledAt: null,
            startAt: { gt: now },
          };
        case "active":
          return {
            cancelledAt: null,
            startAt: { lte: now },
            OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
          };
        case "expired":
          return {
            cancelledAt: null,
            expiresAt: { lte: now },
          };
        case "cancelled":
          return {
            cancelledAt: { not: null },
          };
        default:
          return {};
      }
    })();

    const [items, total] = await Promise.all([
      prisma.notificationAnnouncement.findMany({
        where,
        include: {
          institution: {
            select: { id: true, code: true, name: true },
          },
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip,
        take: query.limit,
      }),
      prisma.notificationAnnouncement.count({ where }),
    ]);

    return {
      items: items.map((item: AdminAnnouncementRecord) => this.serializeAdminAnnouncement(item)),
      pagination: buildPagination(query.page, query.limit, total),
    };
  }

  async cancelAdminAnnouncement(
    actorId: number,
    actorRole: string,
    announcementId: string,
    context: AdminRequestContext = {}
  ) {
    this.assertAdminAnnouncementsEnabled();
    if (actorRole !== "SUPERADMIN") {
      throw new ForbiddenError("Superadmin access is required for this action.");
    }

    if (!context.sessionId) {
      throw new AppError(
        "Your admin session context is missing. Please sign in again.",
        401,
        "SESSION_INVALID"
      );
    }

    const id = toBigIntId(announcementId, "announcement id");
    const routeKey = buildRouteKey(
      "PATCH",
      "/api/admin/notifications/announcements/:announcementId/cancel",
      { announcementId }
    );

    return idempotencyService.execute(
      this.buildAdminMutationContext(
        actorId,
        routeKey,
        context.idempotencyKey,
        { announcementId }
      ),
      async () =>
        this.runTransaction(async (tx) => {
          const stepUp = await adminStepUpService.assertVerifiedForSensitiveActionTx(
            tx,
            actorId,
            actorRole,
            context,
            "CANCEL_NOTIFICATION_ANNOUNCEMENT",
            announcementId
          );

          const existing = await tx.notificationAnnouncement.findUnique({
            where: { id },
            include: {
              institution: {
                select: { id: true, code: true, name: true },
              },
            },
          });

          if (!existing) {
            throw new NotFoundError("Announcement not found.");
          }

          const updated =
            existing.cancelledAt
              ? existing
              : await tx.notificationAnnouncement.update({
                  where: { id },
                  data: {
                    cancelledAt: new Date(),
                  },
                  include: {
                    institution: {
                      select: { id: true, code: true, name: true },
                    },
                  },
                });

          await tx.adminAuditLog.create({
            data: {
              actorId,
              actorRole,
              action: "NOTIFICATION_ANNOUNCEMENT_CANCELLED",
              targetType: "SYSTEM",
              targetId: updated.id.toString(),
              metadata: {
                stepUpChallengeId: stepUp.challengeId,
                cancelledAt: updated.cancelledAt?.toISOString() ?? null,
              },
              reason: updated.title,
              ipAddress: context.ipAddress,
            },
          });

          return {
            announcement: this.serializeAdminAnnouncement(updated),
          };
        })
    );
  }
}

export const notificationsService = new NotificationsService();
