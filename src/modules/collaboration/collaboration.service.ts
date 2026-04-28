import { FastifyInstance } from 'fastify';
import prisma from '../../config/database';
import { AppError } from '../../shared/errors/AppError';
import { AuthError } from '../../shared/errors/AuthError';
import { ForbiddenError } from '../../shared/errors/ForbiddenError';
import { NotFoundError } from '../../shared/errors/NotFoundError';
import { ValidationError } from '../../shared/errors/ValidationError';
import { getCacheAdapter } from '../../shared/cache/cache';
import { selectQuestionsForExam } from '../exams/question-selector';
import { EXAM_CONFIG, EXAM_STATUS, EXAM_TYPES } from '../exams/exams.constants';
import { QUESTION_POOLS } from '../questions/questions.constants';
import { buildCollabDisplayNames, buildScopeKeyFromExamType } from '../../shared/utils/examNaming';
import { buildRouteKey, idempotencyService } from '../../shared/idempotency/idempotency';
import { institutionContextService } from '../../shared/institutions/context';
import { institutionExamConfigService } from '../../shared/institutions/exam-config';
import {
  COLLAB_LIMITS,
  COLLAB_SESSION_STATUS,
  COLLAB_SESSION_TYPE,
  COLLAB_WEBSOCKET_EVENTS,
  PARTICIPANT_STATE
} from './collaboration.constants';
import {
  CreateSessionInput,
  IdempotentContext,
  SessionSnapshotResponse,
  StartSessionResponse
} from './collaboration.types';
import { SessionManager } from './session-manager';

type TxClient = any;

interface PresenceParticipant {
  userId: number;
  participantState: string;
}

interface SessionWithParticipants {
  id: number;
  sessionCode: string;
  sessionType: string;
  institutionId: number | null;
  questionSource: string;
  nameScopeKey: string;
  sessionNumber: number;
  customName: string | null;
  status: string;
  subjectsIncluded: string[];
  totalQuestions: number;
  maxParticipants: number | null;
  hostUserId: number;
  startedAt: Date | null;
  endedAt: Date | null;
  participants: Array<{
    userId: number;
    participantState: string;
    joinedAt: Date;
    finishedAt: Date | null;
    score: number | null;
    spEarned: number | null;
    finalRank: number | null;
    user: { fullName: string };
  }>;
}

interface EventPayload {
  type: string;
  payload: Record<string, unknown>;
}

interface SessionCompletionCheckResult {
  shouldComplete: boolean;
  standings: Array<{
    userId: number;
    fullName: string;
    score: number;
    spEarned: number;
    rank: number;
  }>;
}

const SESSION_FETCH_INCLUDE = {
  participants: {
    include: {
      user: {
        select: {
          fullName: true
        }
      }
    },
    orderBy: {
      joinedAt: 'asc'
    }
  }
} as const;

export class CollaborationService {
  private readonly app: FastifyInstance;
  private readonly sessionManager: SessionManager;
  private readonly wsEventFallback = new Map<string, number>();
  private readonly heartbeatDbSyncCache = new Map<string, number>();

  private static readonly IDEMPOTENCY_TTL_SECONDS = Number.parseInt(
    process.env.COLLAB_IDEMPOTENCY_TTL_SECONDS || `${COLLAB_LIMITS.IDEMPOTENCY_TTL_SECONDS}`,
    10
  );

  private static readonly START_LOCK_TTL_SECONDS = Number.parseInt(
    process.env.COLLAB_START_LOCK_TTL_SECONDS || `${COLLAB_LIMITS.START_LOCK_TTL_SECONDS}`,
    10
  );

  private static readonly JOIN_LOCK_TTL_SECONDS = Number.parseInt(
    process.env.COLLAB_JOIN_LOCK_TTL_SECONDS || `${COLLAB_LIMITS.START_LOCK_TTL_SECONDS}`,
    10
  );

  private static readonly EVENT_DEDUPE_TTL_SECONDS = Number.parseInt(
    process.env.COLLAB_EVENT_DEDUPE_TTL_SECONDS || '90',
    10
  );

  private static readonly HEARTBEAT_DB_SYNC_SECONDS = Number.parseInt(
    process.env.COLLAB_HEARTBEAT_DB_SYNC_SECONDS || '60',
    10
  );
  private static readonly TX_MAX_WAIT_MS = Number.parseInt(
    process.env.COLLAB_TX_MAX_WAIT_MS || '10000',
    10
  );
  private static readonly TX_TIMEOUT_MS = Number.parseInt(
    process.env.COLLAB_TX_TIMEOUT_MS || '20000',
    10
  );

  constructor(app: FastifyInstance, sessionManager: SessionManager) {
    this.app = app;
    this.sessionManager = sessionManager;
  }

  private nowIso(): string {
    return new Date().toISOString();
  }

  private txOptions(): { maxWait: number; timeout: number } {
    return {
      maxWait: CollaborationService.TX_MAX_WAIT_MS,
      timeout: CollaborationService.TX_TIMEOUT_MS
    };
  }

  private async withTransaction<T>(compute: (tx: TxClient) => Promise<T>): Promise<T> {
    return prisma.$transaction(compute, this.txOptions());
  }

  private sanitizeCode(code: string): string {
    return code.trim().toUpperCase();
  }

  private toParticipantState(value: string): string {
    if (!value) return PARTICIPANT_STATE.JOINED;
    return value;
  }

  private compactFallbackCache(): void {
    const now = Date.now();
    for (const [key, expiresAt] of this.wsEventFallback.entries()) {
      if (expiresAt <= now) {
        this.wsEventFallback.delete(key);
      }
    }
  }

  private async withIdempotency<T>(ctx: IdempotentContext, compute: () => Promise<T>): Promise<T> {
    return idempotencyService.execute(
      {
        userId: ctx.userId,
        routeKey: ctx.routeKey,
        idempotencyKey: ctx.idempotencyKey,
        payload: ctx.payload,
        ttlSeconds: CollaborationService.IDEMPOTENCY_TTL_SECONDS
      },
      compute
    );
  }

  private async acquireLock(key: string, ttlSeconds: number): Promise<string | null> {
    const cache = getCacheAdapter();
    if (!cache.available) return null;

    const owner = `${Date.now()}:${Math.random().toString(36).slice(2)}`;
    const acquired = await cache.acquireLock(key, owner, ttlSeconds);
    if (!acquired) return null;
    return owner;
  }

  private async releaseLock(key: string, owner: string | null): Promise<void> {
    if (!owner) return;
    const cache = getCacheAdapter();
    if (!cache.available) return;
    try {
      await cache.releaseLock(key, owner);
    } catch {
      // Lock TTL is a safe fallback.
    }
  }

  private async incrementMetric(metric: string): Promise<void> {
    this.app.metrics.incrementCounter('collab_events_total', 1, { metric });

    const cache = getCacheAdapter();
    if (!cache.available) return;

    const key = `collab:metrics:${metric}:${new Date().toISOString().slice(0, 10)}`;
    try {
      const count = await cache.incr(key);
      if (count === 1) {
        await cache.expire(key, 172800);
      }
    } catch {
      // Metrics should never break request flow.
    }
  }

  private async nextExamSessionNumber(tx: TxClient, userId: number, scopeKey: string): Promise<number> {
    const counter = await tx.examSessionCounter.upsert({
      where: {
        userId_scopeKey: {
          userId,
          scopeKey
        }
      },
      create: {
        userId,
        scopeKey,
        currentValue: 1
      },
      update: {
        currentValue: { increment: 1 }
      },
      select: {
        currentValue: true
      }
    });

    return counter.currentValue;
  }

  private async nextCollaborationSessionNumber(tx: TxClient, userId: number, scopeKey: string): Promise<number> {
    const counter = await tx.collaborationSessionCounter.upsert({
      where: {
        userId_scopeKey: {
          userId,
          scopeKey
        }
      },
      create: {
        userId,
        scopeKey,
        currentValue: 1
      },
      update: {
        currentValue: { increment: 1 }
      },
      select: {
        currentValue: true
      }
    });

    return counter.currentValue;
  }

  private normalizeCustomName(input?: string | null): string | null {
    if (input === undefined || input === null) return null;
    const normalized = input.trim();
    if (normalized.length === 0) return null;
    if (normalized.length < 3 || normalized.length > 80) {
      throw new ValidationError('Custom session name must be between 3 and 80 characters.');
    }
    if (/[\u0000-\u001F\u007F]/.test(normalized)) {
      throw new ValidationError('Custom session name contains invalid control characters.');
    }
    return normalized;
  }

  private async enforceEventRateLimit(
    sessionId: number,
    userId: number,
    eventType: string
  ): Promise<void> {
    const cache = getCacheAdapter();
    if (!cache.available) return;

    let max = 60;
    if (eventType === COLLAB_WEBSOCKET_EVENTS.EMOJI_REACTION) max = COLLAB_LIMITS.EMOJI_RATE_LIMIT_MAX;
    if (eventType === COLLAB_WEBSOCKET_EVENTS.PROGRESS_UPDATE) max = COLLAB_LIMITS.PROGRESS_RATE_LIMIT_MAX;
    if (eventType === COLLAB_WEBSOCKET_EVENTS.TIME_ALERT) max = COLLAB_LIMITS.TIME_ALERT_RATE_LIMIT_MAX;

    const key = `collab:ws:rate:${sessionId}:${userId}:${eventType}`;
    const count = await cache.incr(key);
    if (count === 1) {
      await cache.expire(key, COLLAB_LIMITS.EVENT_RATE_LIMIT_WINDOW_SECONDS);
    }
    if (count > max) {
      throw new AppError(
        'You are sending updates too fast. Slow down a little so everyone gets smooth real-time updates.',
        429,
        'COLLAB_EVENT_RATE_LIMIT'
      );
    }
  }

  private async isDuplicateWsEvent(
    sessionId: number,
    userId: number,
    eventId?: string
  ): Promise<boolean> {
    if (!eventId || eventId.trim().length === 0) return false;
    const normalizedEventId = eventId.trim();
    const key = `collab:ws:event:${sessionId}:${userId}:${normalizedEventId}`;
    const cache = getCacheAdapter();

    if (cache.available) {
      const owner = `${Date.now()}:${Math.random().toString(36).slice(2)}`;
      const acquired = await cache.acquireLock(
        key,
        owner,
        CollaborationService.EVENT_DEDUPE_TTL_SECONDS
      );
      return !acquired;
    }

    this.compactFallbackCache();
    const now = Date.now();
    const existing = this.wsEventFallback.get(key);
    if (existing && existing > now) return true;
    this.wsEventFallback.set(
      key,
      now + (CollaborationService.EVENT_DEDUPE_TTL_SECONDS * 1000)
    );
    return false;
  }

  private async loadCollaborationEligibilityContext(
    userId: number,
    input: {
      institutionCode?: string | null;
      institutionId?: number | null;
    } = {},
    tx: TxClient = prisma
  ): Promise<{
    institution: { id: number; code: string; name: string; slug: string; source: string };
    config: Awaited<ReturnType<typeof institutionExamConfigService.getActiveConfigForInstitutionId>>;
    account: {
      isPremium: boolean;
      isBanned: boolean;
      bannedReason: string | null;
      institutionStats: Array<{ realExamsCompleted: number }>;
    } | null;
    scopedRealExamsCompleted: number;
  }> {
    const institution = typeof input.institutionId === 'number'
      ? await institutionContextService.resolveById(input.institutionId, tx as any)
      : await institutionContextService.resolveForUser(userId, input.institutionCode, tx as any);

    const [account, config] = await Promise.all([
      tx.user.findUnique({
        where: { id: userId },
        select: {
          isPremium: true,
          isBanned: true,
          bannedReason: true,
          institutionStats: {
            where: { institutionId: institution.id },
            select: { realExamsCompleted: true },
            take: 1
          }
        }
      }),
      institutionExamConfigService.getActiveConfigForInstitutionId(institution.id, tx as any)
    ]);

    return {
      institution,
      config,
      account,
      scopedRealExamsCompleted: account?.institutionStats[0]?.realExamsCompleted ?? 0
    };
  }

  private async assertCollaborationEligibility(
    userId: number,
    input: {
      institutionCode?: string | null;
      institutionId?: number | null;
    } = {},
    tx: TxClient = prisma
  ): Promise<{
    institution: { id: number; code: string; name: string; slug: string; source: string };
    config: Awaited<ReturnType<typeof institutionExamConfigService.getActiveConfigForInstitutionId>>;
  }> {
    const eligibility = await this.loadCollaborationEligibilityContext(userId, input, tx);
    const { account, institution, config, scopedRealExamsCompleted } = eligibility;

    if (!account) {
      throw new AuthError('Your account could not be found. Please log in again.', 401, 'SESSION_INVALID');
    }

    if (account.isBanned) {
      throw new AuthError(
        account.bannedReason
          ? `Your account is suspended: ${account.bannedReason}`
          : 'Your account is suspended. Please contact support.',
        403,
        'ACCOUNT_BANNED'
      );
    }

    if (!account.isPremium) {
      throw new ForbiddenError('Collaboration is a premium feature. Upgrade to unlock 1v1 duels.');
    }

    if (scopedRealExamsCompleted < config.collaborationGateRealExams) {
      throw new ForbiddenError(
        `Collaboration unlocks after ${config.collaborationGateRealExams} completed real exams in this institution. You are very close, complete a few more and come back.`
      );
    }

    return {
      institution,
      config
    };
  }

  private async lockSessionRow(tx: TxClient, sessionId: number): Promise<void> {
    await tx.$queryRawUnsafe(
      'SELECT "id" FROM "CollaborationSession" WHERE "id" = $1 FOR UPDATE',
      sessionId
    );
  }

  private async findSessionByCode(
    code: string,
    tx: TxClient = prisma
  ): Promise<SessionWithParticipants | null> {
    return tx.collaborationSession.findUnique({
      where: { sessionCode: this.sanitizeCode(code) },
      include: SESSION_FETCH_INCLUDE
    });
  }

  private async findSessionById(
    sessionId: number,
    tx: TxClient = prisma
  ): Promise<SessionWithParticipants | null> {
    return tx.collaborationSession.findUnique({
      where: { id: sessionId },
      include: SESSION_FETCH_INCLUDE
    });
  }

  private mapSessionSnapshot(
    session: SessionWithParticipants,
    myExamId?: number | null
  ): SessionSnapshotResponse {
    const naming = buildCollabDisplayNames(
      session.sessionType,
      session.subjectsIncluded,
      session.sessionNumber,
      session.customName
    );

    return {
      session: {
        id: session.id,
        code: session.sessionCode,
        sessionType: session.sessionType as any,
        status: session.status as any,
        sessionNumber: session.sessionNumber,
        displayNameLong: naming.displayNameLong,
        displayNameShort: naming.displayNameShort,
        customName: session.customName ?? null,
        effectiveDisplayName: naming.effectiveDisplayName,
        questionSource: session.questionSource as any,
        subjects: [...session.subjectsIncluded],
        totalQuestions: session.totalQuestions,
        maxParticipants: session.maxParticipants ?? COLLAB_LIMITS.DEFAULT_MAX_PARTICIPANTS,
        hostUserId: session.hostUserId,
        startedAt: session.startedAt ? session.startedAt.toISOString() : null,
        endedAt: session.endedAt ? session.endedAt.toISOString() : null,
        participants: session.participants.map((participant) => ({
          userId: participant.userId,
          fullName: participant.user.fullName,
          participantState: this.toParticipantState(participant.participantState) as any,
          joinedAt: participant.joinedAt.toISOString(),
          finishedAt: participant.finishedAt ? participant.finishedAt.toISOString() : null,
          score: participant.score,
          spEarned: participant.spEarned,
          finalRank: participant.finalRank
        }))
      },
      myExamId: myExamId ?? null
    };
  }

  private async generateUniqueSessionCode(tx: TxClient): Promise<string> {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    for (let attempt = 0; attempt < 8; attempt += 1) {
      let generated = '';
      for (let i = 0; i < COLLAB_LIMITS.SESSION_CODE_LENGTH; i += 1) {
        generated += alphabet[Math.floor(Math.random() * alphabet.length)];
      }

      const exists = await tx.collaborationSession.findUnique({
        where: { sessionCode: generated },
        select: { id: true }
      });
      if (!exists) return generated;
    }
    throw new AppError(
      'Unable to reserve a collaboration code right now. Please retry in a moment.',
      503,
      'COLLAB_CODE_GENERATION_FAILED'
    );
  }

  private normalizeCreateInput(input: CreateSessionInput): CreateSessionInput {
    if (input.sessionType !== COLLAB_SESSION_TYPE.ONE_V_ONE_DUEL) {
      throw new ValidationError('Only 1v1 duel sessions are available in this release.');
    }

    if (!Array.isArray(input.subjects) || input.subjects.length === 0) {
      throw new ValidationError('At least one subject is required to create a collaboration session.');
    }

    const uniqueSubjects = Array.from(new Set(input.subjects));
    if (uniqueSubjects.length !== input.subjects.length) {
      throw new ValidationError('Duplicate subjects are not allowed in a collaboration session.');
    }

    if (input.maxParticipants && input.maxParticipants !== COLLAB_LIMITS.MAX_PARTICIPANTS_V1) {
      throw new ValidationError('For this release, collaboration sessions support exactly 2 participants.');
    }

    return {
      sessionType: COLLAB_SESSION_TYPE.ONE_V_ONE_DUEL,
      institutionCode: input.institutionCode,
      subjects: uniqueSubjects,
      questionSource: input.questionSource,
      maxParticipants: COLLAB_LIMITS.MAX_PARTICIPANTS_V1,
      customName: this.normalizeCustomName(input.customName) ?? undefined
    };
  }

  async getSessionByCode(code: string, userId: number): Promise<SessionSnapshotResponse> {
    const session = await this.findSessionByCode(code);
    if (!session) {
      throw new NotFoundError('We could not find that collaboration session code.');
    }

    const participant = session.participants.find((p) => p.userId === userId);
    const myExamId = participant
      ? await this.getParticipantExamId(session.id, userId)
      : null;

    return this.mapSessionSnapshot(session, myExamId);
  }

  async getSessionById(sessionId: number, userId: number): Promise<SessionSnapshotResponse> {
    const session = await this.findSessionById(sessionId);
    if (!session) {
      throw new NotFoundError('Collaboration session not found.');
    }

    const participant = session.participants.find((p) => p.userId === userId);
    const myExamId = participant
      ? await this.getParticipantExamId(session.id, userId)
      : null;

    return this.mapSessionSnapshot(session, myExamId);
  }

  private async getParticipantExamId(sessionId: number, userId: number): Promise<number | null> {
    const exam = await prisma.exam.findFirst({
      where: {
        collaborationSessionId: sessionId,
        userId
      },
      select: { id: true }
    });
    return exam?.id ?? null;
  }

  async createSession(
    userId: number,
    input: CreateSessionInput,
    idempotencyKey: string
  ): Promise<SessionSnapshotResponse> {
    const normalized = this.normalizeCreateInput(input);
    return this.withIdempotency(
      {
        userId,
        routeKey: buildRouteKey('POST', '/api/collaboration/create'),
        idempotencyKey,
        payload: normalized
      },
      async () => {
        const created = await this.withTransaction(async (tx: TxClient) => {
          const { institution, config } = await this.assertCollaborationEligibility(
            userId,
            { institutionCode: normalized.institutionCode },
            tx
          );
          const resolvedQuestionSource = institutionExamConfigService.resolveCollaborationQuestionSource(
            normalized.questionSource,
            config
          );
          const code = await this.generateUniqueSessionCode(tx);
          const totalQuestions = institutionExamConfigService.calculateTotalQuestions(normalized.subjects.length, config);
          const scopeKey = buildScopeKeyFromExamType(COLLAB_SESSION_TYPE.ONE_V_ONE_DUEL, normalized.subjects);
          const sessionNumber = await this.nextCollaborationSessionNumber(tx, userId, scopeKey);

          const session = await tx.collaborationSession.create({
            data: {
              sessionType: COLLAB_SESSION_TYPE.ONE_V_ONE_DUEL as any,
              hostUserId: userId,
              institutionId: institution.id,
              sessionCode: code,
              nameScopeKey: scopeKey,
              sessionNumber,
              customName: normalized.customName ?? null,
              subjectsIncluded: normalized.subjects,
              totalQuestions,
              questionSource: resolvedQuestionSource as any,
              status: COLLAB_SESSION_STATUS.WAITING as any,
              isLocked: false,
              maxParticipants: COLLAB_LIMITS.MAX_PARTICIPANTS_V1
            },
            include: SESSION_FETCH_INCLUDE
          });

          await tx.sessionParticipant.create({
            data: {
              sessionId: session.id,
              userId,
              participantState: PARTICIPANT_STATE.JOINED as any
            }
          });

          return this.findSessionById(session.id, tx);
        });

        if (!created) {
          throw new AppError('Session was created but could not be loaded. Please retry.', 500, 'COLLAB_CREATE_FAILED');
        }

        await this.incrementMetric('session_create_success');
        await this.publishSessionEvent(created.id, {
          type: COLLAB_WEBSOCKET_EVENTS.PRESENCE_UPDATE,
          payload: await this.buildPresencePayload(created.id, created.participants)
        });

        return this.mapSessionSnapshot(created, null);
      }
    );
  }

  async joinSession(
    userId: number,
    code: string,
    idempotencyKey: string
  ): Promise<SessionSnapshotResponse> {
    const normalizedCode = this.sanitizeCode(code);
    return this.withIdempotency(
      {
        userId,
        routeKey: buildRouteKey('POST', '/api/collaboration/code/:code/join', { code: normalizedCode }),
        idempotencyKey,
        payload: { code: normalizedCode }
      },
      async () => {
        const sessionForEligibility = await this.findSessionByCode(normalizedCode);
        if (!sessionForEligibility) {
          throw new NotFoundError('Collaboration room code not found. Check the code and try again.');
        }

        await this.assertCollaborationEligibility(userId, {
          institutionId: sessionForEligibility.institutionId ?? undefined
        });

        const lockKey = `collab:lock:join:${normalizedCode}`;
        const lockOwner = await this.acquireLock(lockKey, CollaborationService.JOIN_LOCK_TTL_SECONDS);
        if (getCacheAdapter().available && !lockOwner) {
          await this.incrementMetric('join_lock_contention');
          throw new AppError(
            'Another player is joining this room right now. Please retry once.',
            409,
            'COLLAB_JOIN_RACE'
          );
        }

        try {
          const joined = await this.withTransaction(async (tx: TxClient) => {
            const session = await this.findSessionByCode(normalizedCode, tx);
            if (!session) {
              throw new NotFoundError('Collaboration room code not found. Check the code and try again.');
            }

            await this.lockSessionRow(tx, session.id);
            const lockedSession = await this.findSessionById(session.id, tx);
            if (!lockedSession) {
              throw new NotFoundError('Collaboration session could not be loaded after lock.');
            }

            if (lockedSession.status !== COLLAB_SESSION_STATUS.WAITING) {
              throw new AppError(
                'This session is no longer accepting participants.',
                409,
                'COLLAB_SESSION_NOT_JOINABLE'
              );
            }

            const existingParticipant = lockedSession.participants.find(
              (participant) => participant.userId === userId
            );
            if (existingParticipant) {
              return lockedSession;
            }

            const maxParticipants = lockedSession.maxParticipants ?? COLLAB_LIMITS.MAX_PARTICIPANTS_V1;
            if (lockedSession.participants.length >= maxParticipants) {
              throw new AppError(
                'This 1v1 room is already full. Ask your friend for a new room code.',
                409,
                'COLLAB_SESSION_FULL'
              );
            }

            await tx.sessionParticipant.create({
              data: {
                sessionId: lockedSession.id,
                userId,
                participantState: PARTICIPANT_STATE.JOINED as any
              }
            });

            await tx.collaborationSession.update({
              where: { id: lockedSession.id },
              data: {
                version: { increment: 1 }
              }
            });

            return this.findSessionById(lockedSession.id, tx);
          });

          if (!joined) {
            throw new AppError('Failed to join collaboration session. Please retry.', 500, 'COLLAB_JOIN_FAILED');
          }

          await this.incrementMetric('join_success');
          await this.publishSessionEvent(joined.id, {
            type: COLLAB_WEBSOCKET_EVENTS.PRESENCE_UPDATE,
            payload: await this.buildPresencePayload(joined.id, joined.participants)
          });

          return this.mapSessionSnapshot(joined, null);
        } finally {
          await this.releaseLock(lockKey, lockOwner);
        }
      }
    );
  }

  private mapQuestionForClient(question: any): StartSessionResponse['questions'][number] {
    return {
      id: question.id,
      questionText: question.questionText,
      hasImage: question.hasImage,
      imageUrl: question.imageUrl,
      optionA: question.optionA,
      optionB: question.optionB,
      optionC: question.optionC,
      optionD: question.optionD,
      optionE: question.optionE ?? null,
      optionAImageUrl: question.optionAImageUrl ?? null,
      optionBImageUrl: question.optionBImageUrl ?? null,
      optionCImageUrl: question.optionCImageUrl ?? null,
      optionDImageUrl: question.optionDImageUrl ?? null,
      optionEImageUrl: question.optionEImageUrl ?? null,
      parentQuestionText: question.parentQuestionText ?? null,
      parentQuestionImageUrl: question.parentQuestionImageUrl ?? null,
      subject: question.subject,
      topic: question.topic ?? null
    };
  }

  async startSession(
    userId: number,
    sessionId: number,
    idempotencyKey: string
  ): Promise<StartSessionResponse> {
    return this.withIdempotency(
      {
        userId,
        routeKey: buildRouteKey('POST', '/api/collaboration/sessions/:sessionId/start', { sessionId }),
        idempotencyKey,
        payload: { sessionId }
      },
      async () => {
        const sessionForEligibility = await this.findSessionById(sessionId);
        if (!sessionForEligibility) {
          throw new NotFoundError('Collaboration session not found.');
        }

        await this.assertCollaborationEligibility(userId, {
          institutionId: sessionForEligibility.institutionId ?? undefined
        });

        const lockKey = `collab:lock:start:${sessionId}`;
        const lockOwner = await this.acquireLock(lockKey, CollaborationService.START_LOCK_TTL_SECONDS);
        if (getCacheAdapter().available && !lockOwner) {
          await this.incrementMetric('start_lock_contention');
          throw new AppError(
            'Session start is already in progress. Please wait a moment and retry.',
            409,
            'COLLAB_START_RACE'
          );
        }

        try {
          const startedAt = new Date();
          const started = await this.withTransaction(async (tx: TxClient) => {
            const initial = await this.findSessionById(sessionId, tx);
            if (!initial) {
              throw new NotFoundError('Collaboration session not found.');
            }

            await this.lockSessionRow(tx, sessionId);
            const session = await this.findSessionById(sessionId, tx);
            if (!session) {
              throw new NotFoundError('Collaboration session could not be loaded after lock.');
            }

            if (session.hostUserId !== userId) {
              throw new ForbiddenError('Only the host can start this collaboration session.');
            }

            if (session.status !== COLLAB_SESSION_STATUS.WAITING) {
              throw new AppError(
                'This session has already started or ended.',
                409,
                'COLLAB_SESSION_ALREADY_STARTED'
              );
            }

            const activeParticipants = session.participants.filter(
              (participant) => participant.participantState !== PARTICIPANT_STATE.DISCONNECTED
            );
            if (activeParticipants.length !== COLLAB_LIMITS.MAX_PARTICIPANTS_V1) {
              throw new ValidationError('A 1v1 duel requires exactly 2 participants before starting.');
            }

            const fallbackInstitution = await institutionContextService.resolveByCode();
            const config = await institutionExamConfigService.getActiveConfigForInstitutionId(
              session.institutionId ?? fallbackInstitution.id,
              tx as any
            );
            const questions = await selectQuestionsForExam(
              session.subjectsIncluded,
              session.questionSource,
              config.questionsPerSubject,
              [],
              {
                deterministic: false,
                institutionId: session.institutionId ?? undefined,
                realQuestionPool: QUESTION_POOLS.REAL_BANK
              }
            );

            const durationSeconds = config.collaborationDurationSeconds;
            const expiresAt = new Date(
              startedAt.getTime() +
              (durationSeconds * 1000) +
              (EXAM_CONFIG.SUBMISSION_GRACE_PERIOD_SECONDS * 1000)
            );

            const participantsSorted = [...session.participants].sort((a, b) => a.joinedAt.getTime() - b.joinedAt.getTime());
            const createdExams: Array<{ id: number; userId: number }> = [];
            const examScopeKey = buildScopeKeyFromExamType(EXAM_TYPES.ONE_V_ONE_DUEL, session.subjectsIncluded);

            for (const participant of participantsSorted) {
              const sessionNumber = await this.nextExamSessionNumber(tx, participant.userId, examScopeKey);
              const exam = await tx.exam.create({
                data: {
                  userId: participant.userId,
                  institutionId: session.institutionId,
                  examType: EXAM_TYPES.ONE_V_ONE_DUEL as any,
                  nameScopeKey: examScopeKey,
                  sessionNumber,
                  subjectsIncluded: session.subjectsIncluded,
                  totalQuestions: session.totalQuestions,
                  score: 0,
                  percentage: 0,
                  spEarned: 0,
                  timeTakenSeconds: 0,
                  isRetake: false,
                  attemptNumber: 1,
                  maxRetakes: 0,
                  isCollaboration: true,
                  collaborationSessionId: session.id,
                  status: EXAM_STATUS.IN_PROGRESS as any,
                  startedAt
                },
                select: { id: true, userId: true }
              });
              createdExams.push(exam);
            }

            for (const exam of createdExams) {
              const answers = questions.map((question) => ({
                examId: exam.id,
                questionId: question.id,
                userAnswer: null,
                isCorrect: false,
                timeSpentSeconds: 0
              }));
              await tx.examAnswer.createMany({ data: answers });
            }

            await tx.collaborationSession.update({
              where: { id: session.id },
              data: {
                status: COLLAB_SESSION_STATUS.IN_PROGRESS as any,
                isLocked: true,
                startedAt,
                version: { increment: 1 }
              }
            });

            await tx.sessionParticipant.updateMany({
              where: {
                sessionId: session.id,
                participantState: { in: [PARTICIPANT_STATE.JOINED as any, PARTICIPANT_STATE.DISCONNECTED as any] }
              },
              data: {
                participantState: PARTICIPANT_STATE.READY as any
              }
            });

            const updatedSession = await this.findSessionById(session.id, tx);
            if (!updatedSession) {
              throw new AppError('Session started but reload failed.', 500, 'COLLAB_START_FAILED');
            }

            const myExam = createdExams.find((exam) => exam.userId === userId);
            return {
              session: this.mapSessionSnapshot(updatedSession, myExam?.id ?? null),
              questions: questions.map((question) => this.mapQuestionForClient(question)),
              examAssignments: createdExams.map((exam) => ({
                userId: exam.userId,
                examId: exam.id
              })),
              timeAllowedSeconds: durationSeconds,
              startedAt: startedAt.toISOString(),
              expiresAt: expiresAt.toISOString()
            };
          });

          await this.incrementMetric('start_success');
          await this.publishSessionEvent(sessionId, {
            type: COLLAB_WEBSOCKET_EVENTS.SESSION_STARTED,
            payload: {
              sessionId,
              startedAt: started.startedAt,
              expiresAt: started.expiresAt,
              timeAllowedSeconds: started.timeAllowedSeconds,
              examAssignments: started.examAssignments
            }
          });

          return {
            session: started.session.session,
            myExamId: started.session.myExamId,
            questions: started.questions,
            examAssignments: started.examAssignments,
            timeAllowedSeconds: started.timeAllowedSeconds,
            startedAt: started.startedAt,
            expiresAt: started.expiresAt
          };
        } finally {
          await this.releaseLock(lockKey, lockOwner);
        }
      }
    );
  }

  async leaveSession(
    userId: number,
    sessionId: number,
    idempotencyKey: string
  ): Promise<{ success: boolean; message: string; session?: SessionSnapshotResponse['session'] }> {
    return this.withIdempotency(
      {
        userId,
        routeKey: buildRouteKey('POST', '/api/collaboration/sessions/:sessionId/leave', { sessionId }),
        idempotencyKey,
        payload: { sessionId }
      },
      async () => {
        const result = await this.withTransaction(async (tx: TxClient) => {
          const session = await this.findSessionById(sessionId, tx);
          if (!session) {
            throw new NotFoundError('Collaboration session not found.');
          }

          await this.lockSessionRow(tx, session.id);
          const lockedSession = await this.findSessionById(session.id, tx);
          if (!lockedSession) {
            throw new NotFoundError('Collaboration session could not be loaded after lock.');
          }

          const participant = lockedSession.participants.find((p) => p.userId === userId);
          if (!participant) {
            return {
              success: true,
              message: 'You are already outside this collaboration session.',
              session: lockedSession
            };
          }

          if (lockedSession.status === COLLAB_SESSION_STATUS.WAITING) {
            if (lockedSession.hostUserId === userId) {
              await tx.collaborationSession.update({
                where: { id: lockedSession.id },
                data: {
                  status: COLLAB_SESSION_STATUS.CANCELLED as any,
                  endedAt: new Date(),
                  isLocked: true,
                  version: { increment: 1 }
                }
              });
            } else {
              await tx.sessionParticipant.delete({
                where: {
                  userId_sessionId: {
                    userId,
                    sessionId: lockedSession.id
                  }
                }
              });
              await tx.collaborationSession.update({
                where: { id: lockedSession.id },
                data: {
                  version: { increment: 1 }
                }
              });
            }
          } else if (lockedSession.status === COLLAB_SESSION_STATUS.IN_PROGRESS) {
            await tx.sessionParticipant.update({
              where: {
                userId_sessionId: {
                  userId,
                  sessionId: lockedSession.id
                }
              },
              data: {
                participantState: PARTICIPANT_STATE.DISCONNECTED as any
              }
            });
          }

          const updated = await this.findSessionById(lockedSession.id, tx);
          return {
            success: true,
            message: 'You have left the collaboration session.',
            session: updated ?? lockedSession
          };
        });

        if (result.session) {
          await this.publishSessionEvent(result.session.id, {
            type: COLLAB_WEBSOCKET_EVENTS.PRESENCE_UPDATE,
            payload: await this.buildPresencePayload(
              result.session.id,
              result.session.participants.map((participant: any) => ({
                userId: participant.userId,
                participantState: participant.participantState
              }))
            )
          });
        }

        return {
          success: true,
          message: result.message,
          session: result.session ? this.mapSessionSnapshot(result.session).session : undefined
        };
      }
    );
  }

  async cancelSession(
    userId: number,
    sessionId: number,
    idempotencyKey: string
  ): Promise<SessionSnapshotResponse> {
    return this.withIdempotency(
      {
        userId,
        routeKey: buildRouteKey('POST', '/api/collaboration/sessions/:sessionId/cancel', { sessionId }),
        idempotencyKey,
        payload: { sessionId }
      },
      async () => {
        const cancelled = await this.withTransaction(async (tx: TxClient) => {
          const session = await this.findSessionById(sessionId, tx);
          if (!session) {
            throw new NotFoundError('Collaboration session not found.');
          }

          await this.lockSessionRow(tx, session.id);
          const lockedSession = await this.findSessionById(session.id, tx);
          if (!lockedSession) {
            throw new NotFoundError('Collaboration session could not be loaded after lock.');
          }

          if (lockedSession.hostUserId !== userId) {
            throw new ForbiddenError('Only the host can cancel this collaboration session.');
          }

          if (
            lockedSession.status !== COLLAB_SESSION_STATUS.WAITING &&
            lockedSession.status !== COLLAB_SESSION_STATUS.IN_PROGRESS
          ) {
            return lockedSession;
          }

          await tx.collaborationSession.update({
            where: { id: lockedSession.id },
            data: {
              status: COLLAB_SESSION_STATUS.CANCELLED as any,
              endedAt: new Date(),
              isLocked: true,
              version: { increment: 1 }
            }
          });

          return this.findSessionById(lockedSession.id, tx);
        });

        if (!cancelled) {
          throw new AppError('Failed to cancel collaboration session.', 500, 'COLLAB_CANCEL_FAILED');
        }

        await this.incrementMetric('session_cancelled');
        await this.publishSessionEvent(cancelled.id, {
          type: COLLAB_WEBSOCKET_EVENTS.SESSION_CANCELLED,
          payload: {
            sessionId: cancelled.id,
            endedAt: cancelled.endedAt ? cancelled.endedAt.toISOString() : this.nowIso()
          }
        });

        return this.mapSessionSnapshot(cancelled);
      }
    );
  }

  async updateSessionName(
    userId: number,
    sessionId: number,
    customName: string | null,
    idempotencyKey: string
  ): Promise<SessionSnapshotResponse> {
    return this.withIdempotency(
      {
        userId,
        routeKey: buildRouteKey('PATCH', '/api/collaboration/sessions/:sessionId/name', { sessionId }),
        idempotencyKey,
        payload: { sessionId, customName }
      },
      async () => {
        const normalizedCustomName = this.normalizeCustomName(customName);
        const updated = await this.withTransaction(async (tx: TxClient) => {
          const session = await this.findSessionById(sessionId, tx);
          if (!session) {
            throw new NotFoundError('Collaboration session not found.');
          }

          await this.lockSessionRow(tx, session.id);
          const lockedSession = await this.findSessionById(session.id, tx);
          if (!lockedSession) {
            throw new NotFoundError('Collaboration session could not be loaded after lock.');
          }

          if (lockedSession.hostUserId !== userId) {
            throw new ForbiddenError('Only the host can set or edit the collaboration session name.');
          }

          if (lockedSession.status !== COLLAB_SESSION_STATUS.WAITING) {
            throw new ForbiddenError('Session name can only be edited while the room is waiting.');
          }

          await tx.collaborationSession.update({
            where: { id: lockedSession.id },
            data: {
              customName: normalizedCustomName,
              version: { increment: 1 }
            }
          });

          return this.findSessionById(lockedSession.id, tx);
        });

        if (!updated) {
          throw new AppError('Failed to update collaboration session name.', 500, 'COLLAB_RENAME_FAILED');
        }

        const snapshot = this.mapSessionSnapshot(updated);
        await this.publishSessionEvent(updated.id, {
          type: COLLAB_WEBSOCKET_EVENTS.SESSION_NAME_UPDATED,
          payload: {
            sessionId: updated.id,
            customName: snapshot.session.customName,
            effectiveDisplayName: snapshot.session.effectiveDisplayName,
            displayNameLong: snapshot.session.displayNameLong,
            displayNameShort: snapshot.session.displayNameShort,
            updatedAt: this.nowIso()
          }
        });

        return snapshot;
      }
    );
  }

  private async buildPresencePayload(
    sessionId: number,
    participants: Array<PresenceParticipant>
  ): Promise<{ sessionId: number; participants: Array<{ userId: number; participantState: string; online: boolean }> }> {
    const cache = getCacheAdapter();
    const enriched: Array<{ userId: number; participantState: string; online: boolean }> = [];
    const redisClient = this.app.cache?.available ? this.app.cache.client : null;

    if (cache.available && redisClient && participants.length > 0) {
      const keys = participants.map((participant) => `collab:presence:${sessionId}:${participant.userId}`);
      const values = await redisClient.mget(...keys);

      for (let index = 0; index < participants.length; index += 1) {
        const participant = participants[index];
        enriched.push({
          userId: participant.userId,
          participantState: participant.participantState,
          online: !!values[index]
        });
      }
    } else {
      for (const participant of participants) {
        enriched.push({
          userId: participant.userId,
          participantState: participant.participantState,
          online: participant.participantState !== PARTICIPANT_STATE.DISCONNECTED
        });
      }
    }

    return { sessionId, participants: enriched };
  }

  private async publishSessionEvent(sessionId: number, event: EventPayload): Promise<void> {
    await this.sessionManager.publish(sessionId, event.type, event.payload);
  }

  async recordPresenceHeartbeat(sessionId: number, userId: number, forceDbSync = false): Promise<void> {
    const cache = getCacheAdapter();
    if (cache.available) {
      await cache.set(
        `collab:presence:${sessionId}:${userId}`,
        this.nowIso(),
        COLLAB_LIMITS.HEARTBEAT_TTL_SECONDS
      );
    }

    const heartbeatKey = `${sessionId}:${userId}`;
    const nowMs = Date.now();
    const lastSyncMs = this.heartbeatDbSyncCache.get(heartbeatKey) ?? 0;
    const syncEveryMs = CollaborationService.HEARTBEAT_DB_SYNC_SECONDS * 1000;

    if (!forceDbSync && nowMs - lastSyncMs < syncEveryMs) {
      return;
    }

    this.heartbeatDbSyncCache.set(heartbeatKey, nowMs);

    await prisma.sessionParticipant.updateMany({
      where: {
        sessionId,
        userId,
        participantState: {
          not: PARTICIPANT_STATE.FINISHED as any
        }
      },
      data: {
        lastHeartbeatAt: new Date(),
        participantState: PARTICIPANT_STATE.READY as any
      }
    });
  }

  async onSocketConnected(sessionId: number, userId: number): Promise<void> {
    await this.recordPresenceHeartbeat(sessionId, userId, true);
    const session = await this.findSessionById(sessionId);
    if (!session) return;

    await this.publishSessionEvent(sessionId, {
      type: COLLAB_WEBSOCKET_EVENTS.PRESENCE_UPDATE,
      payload: await this.buildPresencePayload(
        sessionId,
        session.participants.map((participant) => ({
          userId: participant.userId,
          participantState: participant.participantState
        }))
      )
    });
  }

  async onSocketDisconnected(sessionId: number, userId: number): Promise<void> {
    this.heartbeatDbSyncCache.delete(`${sessionId}:${userId}`);
    const cache = getCacheAdapter();
    const graceSeconds = COLLAB_LIMITS.HEARTBEAT_GRACE_SECONDS;
    const disconnectKey = `collab:disconnect:grace:${sessionId}:${userId}`;

    if (cache.available) {
      await cache.set(disconnectKey, this.nowIso(), graceSeconds);
    }

    setTimeout(async () => {
      try {
        const currentSession = await this.findSessionById(sessionId);
        if (!currentSession || currentSession.status !== COLLAB_SESSION_STATUS.IN_PROGRESS) {
          return;
        }

        if (cache.available) {
          const stillOnline = await cache.get(`collab:presence:${sessionId}:${userId}`);
          if (stillOnline) {
            return;
          }
        }

        await prisma.sessionParticipant.updateMany({
          where: {
            sessionId,
            userId
          },
          data: {
            participantState: PARTICIPANT_STATE.DISCONNECTED as any
          }
        });

        const updated = await this.findSessionById(sessionId);
        if (!updated) return;
        this.heartbeatDbSyncCache.delete(`${sessionId}:${userId}`);
        await this.publishSessionEvent(sessionId, {
          type: COLLAB_WEBSOCKET_EVENTS.PRESENCE_UPDATE,
          payload: await this.buildPresencePayload(
            sessionId,
            updated.participants.map((participant) => ({
              userId: participant.userId,
              participantState: participant.participantState
            }))
          )
        });
      } catch (error) {
        this.app.log.warn({ error, sessionId, userId }, 'Failed to process disconnect grace handler');
      }
    }, graceSeconds * 1000);
  }

  async emitClientRealtimeEvent(
    sessionId: number,
    userId: number,
    eventType: string,
    payload: Record<string, unknown>,
    eventId?: string
  ): Promise<void> {
    const duplicate = await this.isDuplicateWsEvent(sessionId, userId, eventId);
    if (duplicate) {
      return;
    }

    await this.enforceEventRateLimit(sessionId, userId, eventType);

    await this.publishSessionEvent(sessionId, {
      type: eventType,
      payload: {
        ...payload,
        fromUserId: userId,
        sessionId
      }
    });
  }

  private async computeCompletionStatus(sessionId: number, tx: TxClient): Promise<SessionCompletionCheckResult> {
    const participants = await tx.sessionParticipant.findMany({
      where: { sessionId },
      include: {
        user: { select: { fullName: true } }
      },
      orderBy: {
        joinedAt: 'asc'
      }
    });

    if (participants.length === 0) {
      return { shouldComplete: false, standings: [] };
    }

    const allFinished = participants.every((participant: any) => participant.participantState === PARTICIPANT_STATE.FINISHED);
    if (!allFinished) {
      return { shouldComplete: false, standings: [] };
    }

    const exams = await tx.exam.findMany({
      where: {
        collaborationSessionId: sessionId,
        status: EXAM_STATUS.COMPLETED as any
      },
      select: {
        userId: true,
        score: true,
        spEarned: true
      }
    });

    const scoreByUser = new Map<number, { score: number; spEarned: number }>(
      exams.map((exam: any) => [
        exam.userId,
        {
          score: exam.score,
          spEarned: exam.spEarned
        }
      ])
    );
    const standings = participants
      .map((participant: any) => {
        const result = scoreByUser.get(participant.userId);
        return {
          userId: participant.userId,
          fullName: participant.user.fullName,
          score: result?.score ?? 0,
          spEarned: result?.spEarned ?? 0,
          rank: 0
        };
      })
      .sort((a: any, b: any) => b.score - a.score || b.spEarned - a.spEarned || a.userId - b.userId);

    let currentRank = 0;
    let prev: { score: number; spEarned: number } | null = null;
    for (let i = 0; i < standings.length; i += 1) {
      const row = standings[i];
      if (!prev || row.score !== prev.score || row.spEarned !== prev.spEarned) {
        currentRank = i + 1;
      }
      row.rank = currentRank;
      prev = { score: row.score, spEarned: row.spEarned };
    }

    return {
      shouldComplete: true,
      standings
    };
  }

  async markParticipantReady(sessionId: number, userId: number): Promise<void> {
    await prisma.sessionParticipant.updateMany({
      where: {
        sessionId,
        userId,
        participantState: {
          not: PARTICIPANT_STATE.FINISHED as any
        }
      },
      data: {
        participantState: PARTICIPANT_STATE.READY as any,
        lastHeartbeatAt: new Date()
      }
    });

    await this.publishSessionEvent(sessionId, {
      type: COLLAB_WEBSOCKET_EVENTS.READY,
      payload: {
        sessionId,
        userId,
        readyAt: this.nowIso()
      }
    });
  }

  async markParticipantFinished(
    sessionId: number,
    userId: number,
    examId: number
  ): Promise<void> {
    const now = new Date();
    const result = await this.withTransaction(async (tx: TxClient) => {
      const session = await this.findSessionById(sessionId, tx);
      if (!session) {
        throw new NotFoundError('Collaboration session not found.');
      }

      if (session.status !== COLLAB_SESSION_STATUS.IN_PROGRESS) {
        throw new AppError('This collaboration session is not in progress.', 409, 'COLLAB_SESSION_NOT_ACTIVE');
      }

      const exam = await tx.exam.findFirst({
        where: {
          id: examId,
          userId,
          collaborationSessionId: sessionId
        },
        select: {
          id: true,
          status: true,
          score: true,
          spEarned: true
        }
      });

      if (!exam) {
        throw new NotFoundError('Exam record for this collaboration session was not found.');
      }
      if (exam.status !== EXAM_STATUS.COMPLETED) {
        throw new ValidationError('Submit your exam before marking yourself as finished.');
      }

      await tx.sessionParticipant.update({
        where: {
          userId_sessionId: {
            userId,
            sessionId
          }
        },
        data: {
          participantState: PARTICIPANT_STATE.FINISHED as any,
          finishedAt: now,
          score: exam.score,
          spEarned: exam.spEarned
        }
      });

      const completion = await this.computeCompletionStatus(sessionId, tx);
      if (!completion.shouldComplete) {
        return completion;
      }

      for (const standing of completion.standings) {
        await tx.sessionParticipant.update({
          where: {
            userId_sessionId: {
              userId: standing.userId,
              sessionId
            }
          },
          data: {
            finalRank: standing.rank,
            score: standing.score,
            spEarned: standing.spEarned
          }
        });
      }

      await tx.collaborationSession.update({
        where: { id: sessionId },
        data: {
          status: COLLAB_SESSION_STATUS.COMPLETED as any,
          endedAt: now,
          version: { increment: 1 }
        }
      });

      return completion;
    });

    await this.publishSessionEvent(sessionId, {
      type: COLLAB_WEBSOCKET_EVENTS.FINISHED,
      payload: {
        sessionId,
        userId,
        examId,
        finishedAt: now.toISOString()
      }
    });

    if (result.shouldComplete) {
      await this.publishSessionEvent(sessionId, {
        type: COLLAB_WEBSOCKET_EVENTS.SESSION_COMPLETED,
        payload: {
          sessionId,
          completedAt: now.toISOString(),
          standings: result.standings
        }
      });
    }
  }

  async assertUserCanAccessSession(sessionId: number, userId: number): Promise<void> {
    const participant = await prisma.sessionParticipant.findUnique({
      where: {
        userId_sessionId: {
          userId,
          sessionId
        }
      },
      select: { id: true }
    });
    if (!participant) {
      throw new ForbiddenError('You are not part of this collaboration session.');
    }
  }
}
