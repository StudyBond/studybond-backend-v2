import bcrypt from 'bcryptjs';
import jwt, { SignOptions } from 'jsonwebtoken';
import { User } from '@prisma/client';

const SALT_ROUNDS = 10;

// Hash Password
export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, SALT_ROUNDS);
}

// Verify Password
export async function verifyPassword(candidate: string, hash: string): Promise<boolean> {
  return bcrypt.compare(candidate, hash);
}

// Generate Tokens
export function generateTokens(user: User, sessionId: string, deviceId: string) {
  const payload = {
    userId: user.id,
    email: user.email,
    role: user.role,
    sessionId,
    deviceId
  };

  const accessToken = jwt.sign(payload, process.env.JWT_SECRET as string, {
    expiresIn: (process.env.JWT_EXPIRY || '15m') as SignOptions['expiresIn'],
  });

  const refreshToken = jwt.sign(payload, process.env.REFRESH_TOKEN_SECRET as string, {
    expiresIn: (process.env.REFRESH_TOKEN_EXPIRY || '30d') as SignOptions['expiresIn'],
  });

  return { accessToken, refreshToken };
}

import { randomInt } from 'crypto';

// ... (existing imports)

// Generate 6-digit OTP (Secure)
export function generateOTP(): string {
  // Generates integer between 100000 and 999999 (inclusive)
  return randomInt(100000, 1000000).toString();
}

/**
 * Hash an OTP for secure storage
 * slightly different salt rounds/strategy can be used if speed is critical, 
 * but 10 rounds for 15-min OTP is acceptable balance.
 */
export async function hashOtp(otp: string): Promise<string> {
  return bcrypt.hash(otp, SALT_ROUNDS);
}

/**
 * Verify an input OTP against the stored hash
 */
export async function verifyOtpHash(inputOtp: string, storedHash: string): Promise<boolean> {
  return bcrypt.compare(inputOtp, storedHash);
}

export function verifyRefreshToken(token: string): any {
  try {
    return jwt.verify(token, process.env.REFRESH_TOKEN_SECRET as string);
  } catch (error) {
    return null;
  }
}