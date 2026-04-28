import prisma from '../config/database';
import { BOOKMARK_CONFIG } from '../config/constants';
import { getGlobalMetricsRegistry } from '../shared/metrics/global';

type DeleteCountRow = {
  deleted_count: number | bigint;
};

function toDeletedCount(value: number | bigint | null | undefined): number {
  if (typeof value === 'bigint') {
    return Number(value);
  }

  return typeof value === 'number' ? value : 0;
}

async function deleteExpiredBookmarkBatch(cutoff: Date): Promise<number> {
  const rows = await prisma.$queryRaw<DeleteCountRow[]>`
    WITH expired_batch AS (
      SELECT id
      FROM "BookmarkedQuestion"
      WHERE "expiresAt" IS NOT NULL
        AND "expiresAt" <= ${cutoff}
      ORDER BY "expiresAt" ASC, id ASC
      LIMIT ${BOOKMARK_CONFIG.EXPIRY_CLEANUP_BATCH_SIZE}
    ),
    deleted AS (
      DELETE FROM "BookmarkedQuestion"
      WHERE id IN (SELECT id FROM expired_batch)
      RETURNING id
    )
    SELECT COUNT(*)::int AS deleted_count
    FROM deleted
  `;

  return toDeletedCount(rows[0]?.deleted_count);
}

export async function runExpiredBookmarkCleanup(now = new Date()): Promise<{
  deletedBookmarks: number;
  batchesProcessed: number;
}> {
  const metrics = getGlobalMetricsRegistry();
  const startedAt = Date.now();
  let deletedBookmarks = 0;
  let batchesProcessed = 0;

  for (let batchIndex = 0; batchIndex < BOOKMARK_CONFIG.EXPIRY_CLEANUP_MAX_BATCHES; batchIndex += 1) {
    const deletedInBatch = await deleteExpiredBookmarkBatch(now);
    if (deletedInBatch === 0) {
      break;
    }

    deletedBookmarks += deletedInBatch;
    batchesProcessed += 1;

    if (deletedInBatch < BOOKMARK_CONFIG.EXPIRY_CLEANUP_BATCH_SIZE) {
      break;
    }
  }

  const durationMs = Date.now() - startedAt;
  metrics?.incrementCounter('bookmark_cleanup_runs_total');
  metrics?.incrementCounter('bookmark_cleanup_deleted_total', deletedBookmarks);
  metrics?.observeHistogram('bookmark_cleanup_duration_ms', durationMs);
  metrics?.setGauge('bookmark_cleanup_last_deleted_count', deletedBookmarks);

  return {
    deletedBookmarks,
    batchesProcessed
  };
}
