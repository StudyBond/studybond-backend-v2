import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const originalEnv = { ...process.env };

async function loadCleanupModule(batchResults: Array<number | bigint>) {
  vi.resetModules();

  const queryRaw = vi.fn();
  for (const result of batchResults) {
    queryRaw.mockResolvedValueOnce([{ deleted_count: result }]);
  }

  const metrics = {
    incrementCounter: vi.fn(),
    observeHistogram: vi.fn(),
    setGauge: vi.fn()
  };

  vi.doMock('../../config/database', () => ({
    default: {
      $queryRaw: queryRaw
    }
  }));

  vi.doMock('../../shared/metrics/global', () => ({
    getGlobalMetricsRegistry: () => metrics
  }));

  const cleanupModule = await import('../../jobs/bookmark-cleanup');
  return {
    metrics,
    queryRaw,
    runExpiredBookmarkCleanup: cleanupModule.runExpiredBookmarkCleanup
  };
}

describe('expired bookmark cleanup job', () => {
  beforeEach(() => {
    process.env = { ...originalEnv };
    process.env.BOOKMARK_EXPIRY_CLEANUP_BATCH_SIZE = '500';
    process.env.BOOKMARK_EXPIRY_CLEANUP_MAX_BATCHES = '20';
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.env = { ...originalEnv };
  });

  it('processes multiple batches and records cleanup metrics', async () => {
    const { metrics, queryRaw, runExpiredBookmarkCleanup } = await loadCleanupModule([500, 123]);

    const result = await runExpiredBookmarkCleanup(new Date('2026-03-11T12:00:00.000Z'));

    expect(result).toEqual({
      deletedBookmarks: 623,
      batchesProcessed: 2
    });
    expect(queryRaw).toHaveBeenCalledTimes(2);
    expect(metrics.incrementCounter).toHaveBeenNthCalledWith(1, 'bookmark_cleanup_runs_total');
    expect(metrics.incrementCounter).toHaveBeenNthCalledWith(2, 'bookmark_cleanup_deleted_total', 623);
    expect(metrics.setGauge).toHaveBeenCalledWith('bookmark_cleanup_last_deleted_count', 623);
    expect(metrics.observeHistogram).toHaveBeenCalledWith(
      'bookmark_cleanup_duration_ms',
      expect.any(Number)
    );
  });

  it('stops immediately when there is nothing to delete', async () => {
    const { metrics, queryRaw, runExpiredBookmarkCleanup } = await loadCleanupModule([0]);

    const result = await runExpiredBookmarkCleanup(new Date('2026-03-11T12:00:00.000Z'));

    expect(result).toEqual({
      deletedBookmarks: 0,
      batchesProcessed: 0
    });
    expect(queryRaw).toHaveBeenCalledTimes(1);
    expect(metrics.incrementCounter).toHaveBeenNthCalledWith(1, 'bookmark_cleanup_runs_total');
    expect(metrics.incrementCounter).toHaveBeenNthCalledWith(2, 'bookmark_cleanup_deleted_total', 0);
    expect(metrics.setGauge).toHaveBeenCalledWith('bookmark_cleanup_last_deleted_count', 0);
  });
});
