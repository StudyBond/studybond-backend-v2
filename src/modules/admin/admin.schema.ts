import { z } from 'zod';

export const banUserSchema = z.object({
    reason: z.string().min(3).max(255).optional(),
});

export const promoteUserSchema = z.object({
    reason: z.string().optional()
});

export const emailToggleSchema = z.object({
    enabled: z.boolean(),
});

export const paramsIdSchema = z.object({
    id: z.string().transform((val) => parseInt(val, 10)).pipe(z.number().int().positive())
});
