import { describe, expect, it } from 'vitest';
import jwt from 'jsonwebtoken';
import { generateTokens } from '../../shared/utils/jwt';

describe('JWT token versioning', () => {
  it('embeds tokenVersion in access and refresh tokens', () => {
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret';
    process.env.REFRESH_TOKEN_SECRET = process.env.REFRESH_TOKEN_SECRET || 'test-refresh-secret';

    const tokens = generateTokens(
      {
        id: 99,
        email: 'test@example.com',
        role: 'USER'
      },
      'session-1',
      'device-1',
      4
    );

    const accessPayload = jwt.verify(tokens.accessToken, process.env.JWT_SECRET!) as any;
    const refreshPayload = jwt.verify(tokens.refreshToken, process.env.REFRESH_TOKEN_SECRET!) as any;

    expect(accessPayload.tokenVersion).toBe(4);
    expect(refreshPayload.tokenVersion).toBe(4);
  });
});
