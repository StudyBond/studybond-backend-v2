import { randomUUID, timingSafeEqual } from 'crypto';
import { EmailType } from '@prisma/client';
import { getDevToolsConfig } from '../../config/constants';
import { getCacheAdapter, getJson, setJson } from '../cache/cache';
import type { EmailDeliveryMode, TransactionalEmailInput } from '../email/email.types';

const OTP_PREVIEW_EMAIL_TYPES = new Set<EmailType>([
  EmailType.VERIFICATION_OTP,
  EmailType.DEVICE_VERIFICATION_OTP,
  EmailType.PASSWORD_RESET_OTP,
  EmailType.ADMIN_STEP_UP_OTP
]);

const REDIS_INDEX_KEY = 'dev:otp-preview:index';
const ENTRY_KEY_PREFIX = 'dev:otp-preview:entry:';

export interface DevOtpPreviewEntry {
  id: string;
  userId: number;
  email: string;
  emailType: EmailType;
  otpCode: string;
  subject: string;
  deliveryMode: EmailDeliveryMode;
  createdAt: string;
  expiresAt: string;
  metadata?: unknown;
}

export interface DevOtpPreviewFilters {
  email?: string;
  emailType?: EmailType;
  limit?: number;
}

type StoredMemoryPreview = {
  entry: DevOtpPreviewEntry;
  expiresAtMs: number;
};

class InMemoryOtpPreviewStore {
  private readonly entries = new Map<string, StoredMemoryPreview>();
  private idsByCreatedDesc: string[] = [];

  private purgeExpired(now = Date.now()): void {
    this.idsByCreatedDesc = this.idsByCreatedDesc.filter((id) => {
      const stored = this.entries.get(id);
      if (!stored) {
        return false;
      }

      if (stored.expiresAtMs <= now) {
        this.entries.delete(id);
        return false;
      }

      return true;
    });
  }

  record(entry: DevOtpPreviewEntry): void {
    const expiresAtMs = new Date(entry.expiresAt).getTime();
    this.purgeExpired();
    this.entries.set(entry.id, { entry, expiresAtMs });
    this.idsByCreatedDesc = [
      entry.id,
      ...this.idsByCreatedDesc.filter((id) => id !== entry.id)
    ];
  }

  list(filters: Required<Pick<DevOtpPreviewFilters, 'limit'>> & Omit<DevOtpPreviewFilters, 'limit'>): DevOtpPreviewEntry[] {
    this.purgeExpired();

    const normalizedEmail = filters.email?.trim().toLowerCase();
    const results: DevOtpPreviewEntry[] = [];

    for (const id of this.idsByCreatedDesc) {
      const stored = this.entries.get(id);
      if (!stored) continue;

      if (normalizedEmail && stored.entry.email.toLowerCase() !== normalizedEmail) {
        continue;
      }

      if (filters.emailType && stored.entry.emailType !== filters.emailType) {
        continue;
      }

      results.push(stored.entry);
      if (results.length >= filters.limit) {
        break;
      }
    }

    return results;
  }

  clear(filters: DevOtpPreviewFilters): number {
    this.purgeExpired();
    const normalizedEmail = filters.email?.trim().toLowerCase();
    const deletedIds: string[] = [];

    for (const id of this.idsByCreatedDesc) {
      const stored = this.entries.get(id);
      if (!stored) continue;

      if (normalizedEmail && stored.entry.email.toLowerCase() !== normalizedEmail) {
        continue;
      }

      if (filters.emailType && stored.entry.emailType !== filters.emailType) {
        continue;
      }

      deletedIds.push(id);
    }

    for (const id of deletedIds) {
      this.entries.delete(id);
    }

    if (deletedIds.length > 0) {
      const deleted = new Set(deletedIds);
      this.idsByCreatedDesc = this.idsByCreatedDesc.filter((id) => !deleted.has(id));
    }

    return deletedIds.length;
  }
}

function entryKey(id: string): string {
  return `${ENTRY_KEY_PREFIX}${id}`;
}

function normalizeLimit(limit: number | undefined, fallback: number): number {
  return Number.isInteger(limit) && (limit as number) > 0 ? (limit as number) : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, max));
}

function safeJsonValue(value: unknown): unknown {
  if (value === undefined) {
    return null;
  }

  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return null;
  }
}

export class DevOtpPreviewService {
  private readonly memoryStore = new InMemoryOtpPreviewStore();

  private getConfig() {
    return getDevToolsConfig();
  }

  private getReadLimit(limit?: number): number {
    const config = this.getConfig();
    return clamp(
      normalizeLimit(limit, Math.min(5, config.OTP_PREVIEW_LIST_LIMIT_MAX)),
      1,
      config.OTP_PREVIEW_LIST_LIMIT_MAX
    );
  }

  private isRedisBacked(): boolean {
    const cache = getCacheAdapter();
    return Boolean(
      cache.available &&
      cache.zadd &&
      cache.zrevrange &&
      cache.zrem
    );
  }

  isEnabled(): boolean {
    const config = this.getConfig();
    return (
      process.env.NODE_ENV !== 'production' &&
      config.OTP_PREVIEW_ENABLED &&
      config.TOKEN.length >= 16
    );
  }

  isAuthorized(providedToken: string | undefined): boolean {
    if (!this.isEnabled() || !providedToken) {
      return false;
    }

    const expected = Buffer.from(this.getConfig().TOKEN);
    const provided = Buffer.from(providedToken);

    if (expected.length !== provided.length) {
      return false;
    }

    return timingSafeEqual(expected, provided);
  }

  async recordFromEmail(
    input: TransactionalEmailInput,
    deliveryMode: EmailDeliveryMode
  ): Promise<void> {
    if (!this.isEnabled()) return;
    if (!input.debugPreviewCode) return;
    if (!OTP_PREVIEW_EMAIL_TYPES.has(input.emailType)) return;

    const ttlSeconds = this.getConfig().OTP_PREVIEW_TTL_SECONDS;
    const createdAt = new Date();
    const expiresAt = new Date(createdAt.getTime() + ttlSeconds * 1000);

    const entry: DevOtpPreviewEntry = {
      id: randomUUID(),
      userId: input.userId,
      email: input.to.email.trim().toLowerCase(),
      emailType: input.emailType,
      otpCode: input.debugPreviewCode,
      subject: input.subject,
      deliveryMode,
      createdAt: createdAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
      metadata: safeJsonValue(input.metadata)
    };

    if (this.isRedisBacked()) {
      const cache = getCacheAdapter();
      await setJson(entryKey(entry.id), entry, ttlSeconds);
      await cache.zadd!(REDIS_INDEX_KEY, createdAt.getTime(), entry.id);
      return;
    }

    this.memoryStore.record(entry);
  }

  private async listFromRedis(filters: DevOtpPreviewFilters): Promise<DevOtpPreviewEntry[]> {
    const cache = getCacheAdapter();
    const config = this.getConfig();
    const limit = this.getReadLimit(filters.limit);
    const normalizedEmail = filters.email?.trim().toLowerCase();
    const batchSize = clamp(config.OTP_PREVIEW_REDIS_BATCH_SIZE, 10, config.OTP_PREVIEW_SCAN_LIMIT);
    const results: DevOtpPreviewEntry[] = [];
    let offset = 0;
    let scanned = 0;

    while (results.length < limit && scanned < config.OTP_PREVIEW_SCAN_LIMIT) {
      const ids = await cache.zrevrange!(REDIS_INDEX_KEY, offset, offset + batchSize - 1);
      if (ids.length === 0) {
        break;
      }

      offset += ids.length;
      scanned += ids.length;

      const entries = await Promise.all(ids.map(async (id) => ({
        id,
        entry: await getJson<DevOtpPreviewEntry>(entryKey(id))
      })));

      const missingIds = entries
        .filter((item) => !item.entry)
        .map((item) => item.id);

      if (missingIds.length > 0) {
        await Promise.all(missingIds.map((id) => cache.zrem!(REDIS_INDEX_KEY, id)));
      }

      for (const item of entries) {
        if (!item.entry) continue;
        if (normalizedEmail && item.entry.email !== normalizedEmail) continue;
        if (filters.emailType && item.entry.emailType !== filters.emailType) continue;

        results.push(item.entry);
        if (results.length >= limit) {
          break;
        }
      }
    }

    return results;
  }

  async list(filters: DevOtpPreviewFilters = {}): Promise<DevOtpPreviewEntry[]> {
    const normalizedFilters = {
      ...filters,
      limit: this.getReadLimit(filters.limit)
    };

    if (this.isRedisBacked()) {
      return this.listFromRedis(normalizedFilters);
    }

    return this.memoryStore.list(normalizedFilters);
  }

  private async clearFromRedis(filters: DevOtpPreviewFilters): Promise<number> {
    const cache = getCacheAdapter();
    const config = this.getConfig();
    const batchSize = clamp(config.OTP_PREVIEW_REDIS_BATCH_SIZE, 10, config.OTP_PREVIEW_SCAN_LIMIT);
    const normalizedEmail = filters.email?.trim().toLowerCase();
    const idsToDelete = new Set<string>();
    let deletedCount = 0;
    let offset = 0;
    let scanned = 0;

    while (scanned < config.OTP_PREVIEW_SCAN_LIMIT) {
      const ids = await cache.zrevrange!(REDIS_INDEX_KEY, offset, offset + batchSize - 1);
      if (ids.length === 0) {
        break;
      }

      offset += ids.length;
      scanned += ids.length;
      const entries = await Promise.all(ids.map(async (id) => ({
        id,
        entry: await getJson<DevOtpPreviewEntry>(entryKey(id))
      })));

      for (const item of entries) {
        if (!item.entry) {
          idsToDelete.add(item.id);
          continue;
        }

        if (normalizedEmail && item.entry.email !== normalizedEmail) {
          continue;
        }

        if (filters.emailType && item.entry.emailType !== filters.emailType) {
          continue;
        }

        idsToDelete.add(item.id);
      }
    }

    const finalIds = [...idsToDelete];
    if (finalIds.length === 0) {
      return 0;
    }

    if (cache.delMany) {
      await cache.delMany(finalIds.map(entryKey));
    } else {
      await Promise.all(finalIds.map((id) => cache.del(entryKey(id))));
    }

    await Promise.all(finalIds.map((id) => cache.zrem!(REDIS_INDEX_KEY, id)));
    deletedCount += finalIds.length;

    return deletedCount;
  }

  async clear(filters: DevOtpPreviewFilters = {}): Promise<number> {
    if (this.isRedisBacked()) {
      return this.clearFromRedis(filters);
    }

    return this.memoryStore.clear(filters);
  }
}

export const devOtpPreviewService = new DevOtpPreviewService();
