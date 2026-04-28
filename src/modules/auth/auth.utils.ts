import { randomInt } from 'crypto';
export { hashPassword, verifyPassword, hashOtp, verifyOtpHash } from '../../shared/utils/hash';
export { generateTokens, verifyRefreshToken, AuthTokenPayload } from '../../shared/utils/jwt';

// Generate 6-digit OTP (Secure)
export function generateOTP(): string {
  // Generates integer between 100000 and 999999 (inclusive)
  return randomInt(100000, 1000000).toString();
}
