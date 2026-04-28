import { beforeEach, describe, expect, it, vi } from 'vitest';

const { findUniqueMock, reconcileAuthAccessModeMock } = vi.hoisted(() => ({
  findUniqueMock: vi.fn(),
  reconcileAuthAccessModeMock: vi.fn()
}));

vi.mock('../../config/database', () => ({
  default: {
    userSession: {
      findUnique: findUniqueMock
    }
  }
}));

vi.mock('../../shared/auth/accessPolicy', () => ({
  reconcileAuthAccessMode: reconcileAuthAccessModeMock
}));

import { validateToken } from '../../shared/hooks/validateToken';

function buildRequest() {
  return {
    id: 'req-test',
    jwtVerify: vi.fn().mockResolvedValue(undefined),
    user: {
      userId: 42,
      sessionId: 'session-42',
      deviceId: 'device-42',
      tokenVersion: 0
    },
    log: {
      warn: vi.fn(),
      error: vi.fn()
    }
  } as any;
}

function buildSession() {
  return {
    id: 'session-42',
    userId: 42,
    deviceId: 'device-42',
    isActive: true,
    authPolicyVersion: 0,
    tokenVersion: 0,
    user: {
      id: 42,
      isPremium: false,
      subscriptionEndDate: null,
      deviceAccessMode: 'FREE',
      authPolicyVersion: 0,
      isBanned: false,
      bannedReason: null
    }
  };
}

describe('validateToken', () => {
  beforeEach(() => {
    findUniqueMock.mockReset();
    reconcileAuthAccessModeMock.mockReset();
  });

  it('retries once when the first session lookup hits a transient database error', async () => {
    const request = buildRequest();

    findUniqueMock
      .mockRejectedValueOnce(new Error('Connection terminated unexpectedly'))
      .mockResolvedValueOnce(buildSession());

    await expect(validateToken(request)).resolves.toBeUndefined();

    expect(findUniqueMock).toHaveBeenCalledTimes(2);
    expect(request.log.warn).toHaveBeenCalledTimes(1);
  });

  it('returns temporary unavailability when transient session validation errors keep failing', async () => {
    const request = buildRequest();

    findUniqueMock.mockRejectedValue(new Error('Connection terminated unexpectedly'));

    await expect(validateToken(request)).rejects.toMatchObject({
      statusCode: 503,
      code: 'SESSION_VALIDATION_UNAVAILABLE'
    });

    expect(findUniqueMock).toHaveBeenCalledTimes(2);
    expect(request.log.error).toHaveBeenCalledTimes(1);
  });
});
