import jwt, { SignOptions } from 'jsonwebtoken';

export interface AuthTokenPayload {
  userId: number;
  email: string;
  role: string;
  sessionId: string;
  deviceId: string;
  tokenVersion: number;
}

export interface TokenUser {
  id: number;
  email: string;
  role: string;
}

export function generateTokens(
  user: TokenUser,
  sessionId: string,
  deviceId: string,
  tokenVersion: number
) {
  const payload: AuthTokenPayload = {
    userId: user.id,
    email: user.email,
    role: user.role,
    sessionId,
    deviceId,
    tokenVersion
  };

  const accessToken = jwt.sign(payload, process.env.JWT_SECRET as string, {
    expiresIn: (process.env.JWT_EXPIRY || '15m') as SignOptions['expiresIn'],
  });

  const refreshToken = jwt.sign(payload, process.env.REFRESH_TOKEN_SECRET as string, {
    expiresIn: (process.env.REFRESH_TOKEN_EXPIRY || '30d') as SignOptions['expiresIn'],
  });

  return { accessToken, refreshToken };
}

export function verifyRefreshToken(token: string): AuthTokenPayload | null {
  try {
    return jwt.verify(token, process.env.REFRESH_TOKEN_SECRET as string) as AuthTokenPayload;
  } catch {
    return null;
  }
}
