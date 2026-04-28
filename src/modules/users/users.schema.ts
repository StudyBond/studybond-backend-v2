import { z } from 'zod';
import { institutionScopeQuerySchema } from '../../shared/institutions/query';

export const updateProfileSchema = z.object({
  fullName: z.string().trim().min(2).max(120).optional(),
  aspiringCourse: z.union([
    z.string().trim().min(2).max(120),
    z.null()
  ]).optional(),
  targetScore: z.union([
    z.number().int().min(1).max(400),
    z.null()
  ]).optional(),
  emailUnsubscribed: z.boolean().optional()
}).strict().refine(
  (payload) => Object.keys(payload).length > 0,
  'Provide at least one profile field to update.'
);

export const deleteAccountSchema = z.object({
  password: z.string().min(1, 'Current password is required to delete your account.')
}).strict();

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Current password is required.'),
  newPassword: z.string().min(8, 'New password must be at least 8 characters long.').max(128)
}).strict().refine(
  (payload) => payload.currentPassword !== payload.newPassword,
  {
    path: ['newPassword'],
    message: 'New password must be different from your current password.'
  }
);

export const userStatsQuerySchema = institutionScopeQuerySchema;

export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
export type DeleteAccountInput = z.infer<typeof deleteAccountSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
export type UserStatsQueryInput = z.infer<typeof userStatsQuerySchema>;
