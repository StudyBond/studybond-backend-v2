import { z } from 'zod';
import { registerSchema, loginSchema, verifyOtpSchema, refreshTokenSchema } from './auth.schema';

// TypeScript types inferred from schemas
export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type VerifyOtpInput = z.infer<typeof verifyOtpSchema>;
export type RefreshTokenInput = z.infer<typeof refreshTokenSchema>;

// SERVICE RESPONSE TYPES
export interface AuthResponse {
    user: {
        id: number;
        email: string;
        fullName: string;
        isPremium: boolean;
        role: string;
    };
    accessToken: string;
    refreshToken: string;
}