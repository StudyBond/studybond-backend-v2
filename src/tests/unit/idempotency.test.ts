import { describe, expect, it } from 'vitest';
import { buildRouteKey, hashPayload } from '../../shared/idempotency/idempotency';

describe('idempotency helpers', () => {
  it('builds deterministic route keys with identity params only', () => {
    const routeKey = buildRouteKey('post', '/api/exams/:examId/submit', { examId: 42 });
    expect(routeKey).toBe('POST /api/exams/:examId/submit examId=42');
  });

  it('sorts route identity params to keep keys stable', () => {
    const left = buildRouteKey('POST', '/api/collaboration/sessions/:sessionId/name', {
      sessionId: 99,
      shard: 'a'
    });
    const right = buildRouteKey('POST', '/api/collaboration/sessions/:sessionId/name', {
      shard: 'a',
      sessionId: 99
    });
    expect(left).toBe(right);
  });

  it('hashes equivalent payloads identically regardless of object key order', () => {
    const first = hashPayload({
      examType: 'PRACTICE',
      subjects: ['Biology', 'Physics'],
      metadata: { attempt: 1, locale: 'en' }
    });
    const second = hashPayload({
      metadata: { locale: 'en', attempt: 1 },
      subjects: ['Biology', 'Physics'],
      examType: 'PRACTICE'
    });
    expect(first).toBe(second);
  });
});
