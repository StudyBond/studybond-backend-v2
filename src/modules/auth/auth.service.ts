import { prisma } from '../../config/database';
import { RegisterInput, LoginInput, VerifyOtpInput } from './auth.types';
import { hashPassword, verifyPassword, generateTokens, generateOTP, hashOtp, verifyOtpHash, verifyRefreshToken } from './auth.utils';
import { AppError } from '../../shared/errors/AppError';
import { AuthError } from '../../shared/errors/AuthError';
import { AUTH_CONFIG } from '../../config/constants';

export class AuthService {

  /**
   * We ensure only ONE active session exists per user.
   * If User logs in on Device B, Device A session is killed.
   */
  private async killOtherSessions(userId: number, currentDeviceId: string) {
    await prisma.userSession.updateMany({
      where: {
        userId,
        deviceId: { not: currentDeviceId }, // Kill everyone else
        isActive: true,
      },
      data: { isActive: false },
    });
  }

  // REGISTER
  async register(data: RegisterInput) {
    // 1. Check for existing user (Optimistic check)
    const existingUser = await prisma.user.findUnique({ where: { email: data.email } });
    if (existingUser) throw new AppError('Email already in use', 409);

    const passwordHash = await hashPassword(data.password);

    try {
      // Transaction: Create User -> Device -> Session -> Audit Log
      const result = await prisma.$transaction(async (tx) => {
        // Create User
        const user = await tx.user.create({
          data: {
            email: data.email,
            passwordHash,
            fullName: data.fullName,
            aspiringCourse: data.aspiringCourse,
            targetScore: data.targetScore,
          },
        });

        // Create Verified Device (First device is trusted)
        await tx.userDevice.create({
          data: {
            userId: user.id,
            deviceId: data.deviceId,
            deviceName: data.deviceName,
            userAgent: 'App/Browser',
            isVerified: false, // Wait for OTP
            isActive: false,   // Wait for OTP
            lastLoginAt: new Date(),
          },
        });

        // NO Session created yet. Session created on Verify.

        // Audit Log
        await tx.auditLog.create({
          data: {
            userId: user.id,
            action: 'LOGIN_SUCCESS', // It's a signup, but we track the intent
            deviceId: data.deviceId,
            metadata: { reason: 'Registration Initiated' }
          }
        });

        return { user };
      });

      // Generate OTP for Verification
      const otp = generateOTP();
      const otpHash = await hashOtp(otp);
      const expiresAt = new Date(Date.now() + AUTH_CONFIG.OTP_EXPIRY_MS);

      // Update User with OTP
      await prisma.user.update({
        where: { id: result.user.id },
        data: {
          verificationToken: otpHash,
          tokenExpiresAt: expiresAt,
          lastOtpRequestDate: new Date(),
          otpRequestCount: 1
        }
      });

      // Send Email (TODO: SendGrid)
      if (process.env.NODE_ENV === 'development') {
        // Using req.log would require passing req context, using console for dev purity
        console.log(`[DEV MODE] OTP for ${result.user.email}: ${otp}`);
      }

      return {
        requiresOTP: true,
        message: 'Registration successful. Please verify OTP sent to email.'
      };

    } catch (error: any) {
      // Handle Unique Constraint Violation (Race Condition)
      if (error.code === 'P2002') {
        throw new AppError('Email already in use', 409);
      }
      throw error;
    }
  }

  // LOGIN
  async login(data: LoginInput) {
    const user = await prisma.user.findUnique({ where: { email: data.email } });
    if (!user) throw new AuthError('Invalid credentials', 401);

    // 1. Check Verification
    if (!user.isVerified) throw new AuthError('Email not verified. Please verify your email first.', 403, 'EMAIL_NOT_VERIFIED');

    const isValid = await verifyPassword(data.password, user.passwordHash);
    if (!isValid) throw new AuthError('Invalid credentials', 401);

    // Check Device Status
    const device = await prisma.userDevice.findUnique({
      where: {
        userId_deviceId: { userId: user.id, deviceId: data.deviceId }
      }
    });

    // Scenario A: Known & Verified Device
    if (device && device.isVerified) {
      // Kill other sessions (Single Active Session Rule)
      await this.killOtherSessions(user.id, data.deviceId);

      // Create new session
      const session = await prisma.userSession.create({
        data: {
          userId: user.id,
          deviceId: data.deviceId,
          isActive: true,
          expiresAt: new Date(Date.now() + AUTH_CONFIG.SESSION_EXPIRY_MS),
        },
      });

      // Update Device activity
      await prisma.userDevice.update({
        where: { id: device.id },
        data: { isActive: true, lastLoginAt: new Date() }
      });

      const tokens = generateTokens(user, session.id, data.deviceId);
      return { user, ...tokens, requiresOTP: false };
    }

    // Scenario B: New or Unverified Device -> Require OTP

    // 2. CHECK MAX DEVICES RULE (Max 2)
    const deviceCount = await prisma.userDevice.count({
      where: { userId: user.id }
    });

    // If device doesn't exist and we already have 2... BLOCK.
    if (!device && deviceCount >= AUTH_CONFIG.MAX_DEVICES) {
      throw new AuthError(`Maximum device limit reached (${AUTH_CONFIG.MAX_DEVICES}). Login on a previous device or contact admin.`, 403, 'MAX_DEVICES_REACHED');
    }

    // 3. RATE LIMIT OTP
    if (user.otpRequestCount >= AUTH_CONFIG.MAX_OTP_REQUESTS_DAILY) {
      // Reset if day changed (Logic check: is lastOtpRequestDate today?)
      const today = new Date().toISOString().split('T')[0];
      const lastDate = user.lastOtpRequestDate ? user.lastOtpRequestDate.toISOString().split('T')[0] : null;

      if (lastDate === today) {
        throw new AuthError('Maximum OTP requests reached for today. Try again tomorrow.', 429, 'OTP_LIMIT_EXCEEDED');
      } else {
        // Reset count if new day
        await prisma.user.update({ where: { id: user.id }, data: { otpRequestCount: 0 } });
      }
    }

    const otp = generateOTP();
    const otpHash = await hashOtp(otp); // Hash before storage
    const expiresAt = new Date(Date.now() + AUTH_CONFIG.OTP_EXPIRY_MS);

    // Upsert device (create if new, update if exists but unverified)
    await prisma.userDevice.upsert({
      where: { userId_deviceId: { userId: user.id, deviceId: data.deviceId } },
      create: {
        userId: user.id,
        deviceId: data.deviceId,
        deviceName: data.deviceName || 'Unknown',
        userAgent: 'Unknown',
        isVerified: false,
        isActive: false
      },
      update: {
        isActive: false
      }
    });

    // Store HASHED OTP
    await prisma.user.update({
      where: { id: user.id },
      data: {
        verificationToken: otpHash,
        tokenExpiresAt: expiresAt,
        lastOtpRequestDate: new Date(),
        otpRequestCount: { increment: 1 }
      }
    });

    // Send Email (TODO: SendGrid)
    if (process.env.NODE_ENV === 'development') {
      console.log(`[DEV MODE] OTP for ${user.email}: ${otp}`);
    }

    return {
      requiresOTP: true,
      message: 'New device detected. Please verify OTP sent to email.'
    };
  }

  // VERIFY OTP
  async verifyDeviceOtp(data: VerifyOtpInput) {
    const user = await prisma.user.findUnique({ where: { email: data.email } });
    if (!user) throw new AuthError('User not found', 404);

    // Validate OTP Existence & Expiry
    if (!user.verificationToken || !user.tokenExpiresAt || user.tokenExpiresAt < new Date()) {
      throw new AuthError('Invalid or expired OTP', 400);
    }

    // Verify Hash
    const isMatch = await verifyOtpHash(data.otp, user.verificationToken);
    if (!isMatch) {
      throw new AuthError('Invalid OTP', 400);
    }

    // Verify the Device
    await prisma.userDevice.update({
      where: { userId_deviceId: { userId: user.id, deviceId: data.deviceId } },
      data: { isVerified: true, isActive: true, lastLoginAt: new Date() }
    });

    // Mark User as Verified (if not already)
    if (!user.isVerified) {
      await prisma.user.update({
        where: { id: user.id },
        data: { isVerified: true }
      });
    }

    // Clear OTP
    await prisma.user.update({
      where: { id: user.id },
      data: { verificationToken: null, tokenExpiresAt: null }
    });

    // Kill other sessions & Create new one
    await this.killOtherSessions(user.id, data.deviceId);

    const session = await prisma.userSession.create({
      data: {
        userId: user.id,
        deviceId: data.deviceId,
        isActive: true,
      }
    });

    const tokens = generateTokens(user, session.id, data.deviceId);
    return { user, ...tokens, message: 'Device verified successfully' };
  }

  // REFRESH TOKEN
  async refreshToken(refreshToken: string) {
    // 1. Verify Token
    const payload = verifyRefreshToken(refreshToken);
    if (!payload) throw new AuthError('Invalid or expired refresh token', 401);

    const { sessionId, deviceId } = payload as { userId: number; sessionId: string; deviceId: string };

    // 2. Check Session in DB
    const session = await prisma.userSession.findUnique({
      where: { id: sessionId },
      include: { user: true }
    });

    if (!session || !session.isActive) {
      throw new AuthError('Session invalid or expired', 401);
    }

    // 3. Check Session Expiry (DB side)
    if (session.expiresAt && session.expiresAt < new Date()) {
      await prisma.userSession.update({ where: { id: sessionId }, data: { isActive: false } });
      throw new AuthError('Session expired', 401);
    }

    // 4. Generate New Tokens
    // We rotate the refresh token as well for security
    const tokens = generateTokens(session.user, sessionId, deviceId);

    return { ...tokens };
  }

  // LOGOUT
  async logout(userId: number, deviceId: string) {
    // Deactivate session
    await prisma.userSession.updateMany({
      where: { userId, deviceId, isActive: true },
      data: { isActive: false }
    });
    // Do NOT delete the device (User Requirement: Device remains registered)
    return { message: 'Logged out successfully' };
  }
}