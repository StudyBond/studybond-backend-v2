import { describe, expect, it } from 'vitest';
import {
  createSessionBodySchema,
  idempotencyHeadersSchema,
  updateSessionNameBodySchema,
  wsClientEventSchema
} from '../../modules/collaboration/collaboration.schema';

describe('collaboration schema', () => {
  it('validates idempotency header', () => {
    const parsed = idempotencyHeadersSchema.parse({
      'idempotency-key': 'collab-key-12345'
    });
    expect(parsed['idempotency-key']).toBe('collab-key-12345');
  });

  it('rejects duplicate subjects in create payload', () => {
    const result = createSessionBodySchema.safeParse({
      sessionType: 'ONE_V_ONE_DUEL',
      subjects: ['Mathematics', 'Mathematics']
    });
    expect(result.success).toBe(false);
  });

  it('accepts websocket events with eventId', () => {
    const parsed = wsClientEventSchema.parse({
      type: 'progress_update',
      eventId: 'evt_12345678',
      payload: {
        currentQuestion: 2,
        totalQuestions: 100
      }
    });
    expect(parsed.type).toBe('progress_update');
  });

  it('rejects progress websocket events without eventId', () => {
    const result = wsClientEventSchema.safeParse({
      type: 'progress_update',
      payload: {
        currentQuestion: 2,
        totalQuestions: 100
      }
    });
    expect(result.success).toBe(false);
  });

  it('validates custom session rename payload', () => {
    const parsed = updateSessionNameBodySchema.parse({
      customName: 'Focused Biology Duel'
    });
    expect(parsed.customName).toBe('Focused Biology Duel');
  });

  it('accepts explicit practice and mixed question-source selections', () => {
    const practice = createSessionBodySchema.safeParse({
      sessionType: 'ONE_V_ONE_DUEL',
      subjects: ['Biology'],
      questionSource: 'PRACTICE'
    });
    const mixed = createSessionBodySchema.safeParse({
      sessionType: 'ONE_V_ONE_DUEL',
      subjects: ['Biology'],
      questionSource: 'MIXED'
    });

    expect(practice.success).toBe(true);
    expect(mixed.success).toBe(true);
  });

  it('rejects full collaboration exams without English', () => {
    const result = createSessionBodySchema.safeParse({
      sessionType: 'ONE_V_ONE_DUEL',
      subjects: ['Biology', 'Chemistry', 'Physics', 'Mathematics']
    });
    expect(result.success).toBe(false);
  });
});
