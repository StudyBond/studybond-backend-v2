import { FastifyRequest } from 'fastify';
import { AppError } from '../errors/AppError';
import { AuthError } from '../errors/AuthError';
import prisma from '../../config/database';
import { reconcileAuthAccessMode } from '../auth/accessPolicy';

const SESSION_INCLUDE = {
  user: {
    select: {
      id: true,
      isPremium: true,
      subscriptionEndDate: true,
      deviceAccessMode: true,
      authPolicyVersion: true,
      isBanned: true,
      bannedReason: true
    }
  }
} as const;

const SESSION_LOOKUP_MAX_ATTEMPTS = 2;
const SESSION_LOOKUP_RETRY_DELAY_MS = 100;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isTransientDatabaseError(error: unknown): boolean {
  const candidate = error as { code?: string; message?: string; name?: string } | undefined;
  const code = candidate?.code ?? '';
  const message = candidate?.message ?? '';

  return (
    code === 'P1001' ||
    code === 'P1002' ||
    code === 'P1017' ||
    code === 'ECONNRESET' ||
    code === 'ETIMEDOUT' ||
    message.includes('Connection terminated unexpectedly') ||
    message.includes('Can\'t reach database server') ||
    message.includes('Server has closed the connection') ||
    message.includes('Connection lost') ||
    message.includes('Timed out fetching a new connection')
  );
}

async function readSessionWithRetry(request: FastifyRequest, sessionId: string) {
  for (let attempt = 1; attempt <= SESSION_LOOKUP_MAX_ATTEMPTS; attempt += 1) {
    try {
      return await prisma.userSession.findUnique({
        where: { id: sessionId },
        include: SESSION_INCLUDE
      });
    } catch (error) {
      if (!isTransientDatabaseError(error) || attempt === SESSION_LOOKUP_MAX_ATTEMPTS) {
        throw error;
      }

      request.log.warn(
        {
          sessionId,
          attempt,
          requestId: request.id,
          errorCode: (error as any)?.code,
          errorMessage: (error as Error)?.message
        },
        'Transient database error during session validation. Retrying once.'
      );

      await sleep(SESSION_LOOKUP_RETRY_DELAY_MS * attempt);
    }
  }

  return null;
}

async function hasReplacementSession(userId: number, sessionId: string): Promise<boolean> {
  const count = await prisma.userSession.count({
    where: {
      userId,
      id: { not: sessionId },
      isActive: true
    }
  });

  return count > 0;
}

export async function validateToken(request: FastifyRequest): Promise<void> {
  try {
    await request.jwtVerify();
  } catch (error) {
    if (error instanceof AuthError) {
      throw error;
    }

    throw new AuthError('Your session has expired. Please log in again.', 401, 'SESSION_INVALID');
  }

  const payload = request.user as {
    userId: number;
    sessionId: string;
    deviceId: string;
    tokenVersion?: number;
  } | undefined;

  if (!payload?.userId || !payload.sessionId) {
    throw new AuthError('Session payload is invalid. Please log in again.', 401, 'SESSION_INVALID');
  }

  try {
    const session = await readSessionWithRetry(request, payload.sessionId);

    let resolvedSession = session;

    if (
      resolvedSession &&
      (((resolvedSession.user.isPremium &&
        resolvedSession.user.subscriptionEndDate &&
        resolvedSession.user.subscriptionEndDate <= new Date()) ||
        (resolvedSession.user.isPremium && resolvedSession.user.deviceAccessMode !== 'PREMIUM')) ||
        (!resolvedSession.user.isPremium && resolvedSession.user.deviceAccessMode !== 'FREE'))
    ) {
      await reconcileAuthAccessMode(resolvedSession.user.id);
      resolvedSession = await readSessionWithRetry(request, payload.sessionId);
    }

    if (resolvedSession && !resolvedSession.isActive) {
      const replaced = await hasReplacementSession(resolvedSession.userId, resolvedSession.id);
      if (replaced) {
        throw new AuthError(
          'We signed you out because this account became active on another device or browser.',
          401,
          'SESSION_REPLACED'
        );
      }
    }

    if (!resolvedSession || resolvedSession.userId !== payload.userId || resolvedSession.deviceId !== payload.deviceId) {
      throw new AuthError('Your session is no longer active. Please log in again.', 401, 'SESSION_INVALID');
    }

    if (!resolvedSession.isActive) {
      throw new AuthError('Your session is no longer active. Please log in again.', 401, 'SESSION_INVALID');
    }

    if (resolvedSession.authPolicyVersion !== resolvedSession.user.authPolicyVersion) {
      throw new AuthError('Your session is no longer active. Please log in again.', 401, 'SESSION_INVALID');
    }

    if (
      typeof payload.tokenVersion === 'number' &&
      typeof (resolvedSession as any).tokenVersion === 'number' &&
      payload.tokenVersion !== (resolvedSession as any).tokenVersion
    ) {
      throw new AuthError('Your session token has been rotated. Please sign in again.', 401, 'SESSION_INVALID');
    }

    if (resolvedSession.user.isBanned) {
      throw new AuthError(
        resolvedSession.user.bannedReason
          ? `Your account is suspended: ${resolvedSession.user.bannedReason}`
          : 'Your account is suspended. Please contact support.',
        403,
        'ACCOUNT_BANNED'
      );
    }
  } catch (error) {
    if (error instanceof AuthError) {
      throw error;
    }

    if (isTransientDatabaseError(error)) {
      request.log.error(
        {
          requestId: request.id,
          sessionId: payload.sessionId,
          errorCode: (error as any)?.code,
          errorMessage: (error as Error)?.message
        },
        'Session validation failed because the database is temporarily unavailable.'
      );

      throw new AppError(
        'We could not validate your session right now. Please retry in a moment.',
        503,
        'SESSION_VALIDATION_UNAVAILABLE'
      );
    }

    throw error;
  }
}
