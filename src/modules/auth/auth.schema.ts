import { z } from 'zod';

export const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8, "Password must be at least 8 characters"),
  fullName: z.string().min(2),
  aspiringCourse: z.string().optional(),
  targetScore: z.number().max(400).optional(),
  deviceId: z.string().min(1), // Device Info is mandatory for registration
  deviceName: z.string().min(1),
});

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string(),
  deviceId: z.string().min(1),
  deviceName: z.string().optional().default('Unknown Device'),
});

export const verifyOtpSchema = z.object({
  email: z.string().email(),
  deviceId: z.string().min(1),
  otp: z.string().length(6),
});

export const refreshTokenSchema = z.object({
  refreshToken: z.string(),
});
