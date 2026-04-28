import { createHash, randomUUID } from 'crypto';
import prisma from '../../config/database';
import { AppError } from '../errors/AppError';

type IdempotencyState = 'IN_PROGRESS' | 'COMPLETED' | 'FAILED_RETRYABLE' | 'FAILED_FINAL';

interface IdentityParams {
  [key: string]: string | number | boolean | null | undefined;
}

export interface IdempotencyContext {
  userId: number;
  routeKey: string;
  idempotencyKey: string;
  payload: unknown;
  ttlSeconds?: number;
}

const IDEMPOTENCY_TTL_SECONDS = Number.parseInt(
  process.env.IDEMPOTENCY_TTL_SECONDS || '86400',
  10
);

const IDEMPOTENCY_STRICT = process.env.IDEMPOTENCY_ENFORCEMENT_STRICT === 'true';

function stableStringify(input: unknown): string {
  if (input === null || input === undefined) return 'null';

  if (Array.isArray(input)) {
    return `[${input.map((item) => stableStringify(item)).join(',')}]`;
  }

  if (typeof input === 'object') {
    const object = input as Record<string, unknown>;
    const keys = Object.keys(object).sort();
    const entries = keys.map((key) => `${JSON.stringify(key)}:${stableStringify(object[key])}`);
    return `{${entries.join(',')}}`;
  }

  return JSON.stringify(input);
}

export function hashPayload(payload: unknown): string {
  return createHash('sha256').update(stableStringify(payload)).digest('hex');
}

export function buildRouteKey(
  method: string,
  routeTemplate: string,
  identityParams: IdentityParams = {}
): string {
  const normalizedMethod = method.trim().toUpperCase();
  const normalizedRoute = routeTemplate.trim();
  const tokens = Object.entries(identityParams)
    .filter(([, value]) => value !== undefined && value !== null)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${String(value).trim()}`);

  if (tokens.length === 0) {
    return `${normalizedMethod} ${normalizedRoute}`;
  }

  return `${normalizedMethod} ${normalizedRoute} ${tokens.join('&')}`;
}

export function resolveIdempotencyKey(
  rawKey: string | undefined,
  fallbackPrefix: string
): string {
  const normalized = rawKey?.trim();
  if (normalized) return normalized;

  if (IDEMPOTENCY_STRICT) {
    throw new AppError(
      'This action requires an Idempotency-Key header for safe retries.',
      400,
      'IDEMPOTENCY_KEY_REQUIRED'
    );
  }

  return `${fallbackPrefix}:${Date.now()}:${randomUUID()}`;
}

function toStoredError(error: unknown): { statusCode: number; code: string; message: string; retryable: boolean } {
  const raw = error as { statusCode?: number; code?: string; message?: string };
  const statusCode = typeof raw?.statusCode === 'number' ? raw.statusCode : 500;
  const retryable = statusCode >= 500 || statusCode === 429;

  return {
    statusCode,
    code: raw?.code || 'REQUEST_FAILED',
    message: raw?.message || 'Request failed.',
    retryable
  };
}

export class IdempotencyService {
  private async maybeCleanupExpired(): Promise<void> {
    if (Math.random() > 0.02) return;

    try {
      await prisma.idempotencyRecord.deleteMany({
        where: {
          expiresAt: { lt: new Date() }
        }
      });
    } catch {
      // Cleanup failures should never break live requests.
    }
  }

  async execute<T>(context: IdempotencyContext, compute: () => Promise<T>): Promise<T> {
    await this.maybeCleanupExpired();

    const requestHash = hashPayload(context.payload);
    const ttlSeconds = context.ttlSeconds ?? IDEMPOTENCY_TTL_SECONDS;
    const expiresAt = new Date(Date.now() + (ttlSeconds * 1000));

    const uniqueWhere = {
      userId_routeKey_idempotencyKey: {
        userId: context.userId,
        routeKey: context.routeKey,
        idempotencyKey: context.idempotencyKey
      }
    };

    let record = await prisma.idempotencyRecord.findUnique({
      where: uniqueWhere
    });

    if (record) {
      if (record.requestHash !== requestHash) {
        throw new AppError(
          'This idempotency key was already used with a different payload.',
          409,
          'IDEMPOTENCY_KEY_REUSE_MISMATCH'
        );
      }

      const state = record.state as IdempotencyState;

      if (state === 'COMPLETED') {
        if (record.responseBody === null || record.responseBody === undefined) {
          throw new AppError(
            'Stored idempotency replay payload is missing. Please retry with a fresh idempotency key.',
            500,
            'IDEMPOTENCY_REPLAY_MISSING'
          );
        }
        return record.responseBody as T;
      }

      if (state === 'FAILED_FINAL') {
        const stored = (record.responseBody ?? {}) as { message?: string; code?: string };
        throw new AppError(
          stored.message || 'This request previously failed and cannot be retried with the same idempotency key.',
          record.statusCode || 400,
          stored.code || record.errorCode || 'REQUEST_FAILED'
        );
      }

      if (state === 'IN_PROGRESS') {
        throw new AppError(
          'This request is already being processed. Please retry shortly.',
          409,
          'IDEMPOTENCY_IN_PROGRESS'
        );
      }

      const claim = await prisma.idempotencyRecord.updateMany({
        where: {
          id: record.id,
          state: 'FAILED_RETRYABLE' as any
        },
        data: {
          state: 'IN_PROGRESS' as any,
          statusCode: null,
          responseBody: null,
          errorCode: null,
          expiresAt
        }
      });

      if (claim.count !== 1) {
        throw new AppError(
          'This request is already being retried. Please retry shortly.',
          409,
          'IDEMPOTENCY_IN_PROGRESS'
        );
      }
    } else {
      try {
        await prisma.idempotencyRecord.create({
          data: {
            userId: context.userId,
            routeKey: context.routeKey,
            idempotencyKey: context.idempotencyKey,
            requestHash,
            state: 'IN_PROGRESS' as any,
            expiresAt
          }
        });
      } catch (error: any) {
        if (error?.code === 'P2002') {
          record = await prisma.idempotencyRecord.findUnique({
            where: uniqueWhere
          });
          if (record && record.requestHash === requestHash) {
            const existingState = record.state as IdempotencyState;
            if (existingState === 'COMPLETED') {
              return record.responseBody as T;
            }
            if (existingState === 'FAILED_FINAL') {
              const stored = (record.responseBody ?? {}) as { message?: string; code?: string };
              throw new AppError(
                stored.message || 'This request previously failed and cannot be replayed as success.',
                record.statusCode || 400,
                stored.code || record.errorCode || 'REQUEST_FAILED'
              );
            }
          }
          throw new AppError(
            'This request is already being processed. Please retry shortly.',
            409,
            'IDEMPOTENCY_IN_PROGRESS'
          );
        }
        throw error;
      }
    }

    try {
      const result = await compute();
      await prisma.idempotencyRecord.update({
        where: uniqueWhere,
        data: {
          state: 'COMPLETED' as any,
          statusCode: 200,
          responseBody: result as any,
          errorCode: null,
          expiresAt
        }
      });
      return result;
    } catch (error: unknown) {
      const stored = toStoredError(error);
      await prisma.idempotencyRecord.update({
        where: uniqueWhere,
        data: {
          state: stored.retryable ? ('FAILED_RETRYABLE' as any) : ('FAILED_FINAL' as any),
          statusCode: stored.statusCode,
          responseBody: {
            code: stored.code,
            message: stored.message
          },
          errorCode: stored.code,
          expiresAt
        }
      });
      throw error;
    }
  }
}

export const idempotencyService = new IdempotencyService();
