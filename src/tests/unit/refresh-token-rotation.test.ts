import { describe, expect, it } from 'vitest';
import { decideRefreshTokenRotation } from '../../shared/utils/refreshTokenRotation';

describe('decideRefreshTokenRotation', () => {
  it('rotates when the refresh token matches the current session version', () => {
    expect(decideRefreshTokenRotation(4, 4)).toEqual({
      action: 'rotate',
      nextTokenVersion: 5
    });
  });

  it('reuses the current session version for the immediately previous token version', () => {
    expect(decideRefreshTokenRotation(4, 3)).toEqual({
      action: 'reuse-current',
      tokenVersion: 4
    });
  });

  it('rejects stale refresh tokens that are older than one version behind', () => {
    expect(decideRefreshTokenRotation(4, 2)).toEqual({
      action: 'reject'
    });
  });

  it('falls back to the current session version when the payload has no tokenVersion', () => {
    expect(decideRefreshTokenRotation(4, undefined)).toEqual({
      action: 'rotate',
      nextTokenVersion: 5
    });
  });
});
