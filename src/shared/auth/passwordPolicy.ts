import { AuditAction, Prisma } from '@prisma/client';
import { AUTH_CONFIG } from '../../config/constants';
import { AppError } from '../errors/AppError';

type PasswordPolicyDbClient = Pick<Prisma.TransactionClient, 'auditLog'>;

function subtractMilliseconds(now: Date, milliseconds: number): Date {
  return new Date(now.getTime() - milliseconds);
}

export async function assertPasswordChangeAllowed(
  db: PasswordPolicyDbClient,
  userId: number,
  now = new Date()
): Promise<void> {
  const recentChanges = await db.auditLog.count({
    where: {
      userId,
      action: AuditAction.PASSWORD_CHANGED,
      createdAt: {
        gte: subtractMilliseconds(now, 24 * 60 * 60 * 1000)
      }
    }
  });

  if (recentChanges >= AUTH_CONFIG.PASSWORD_CHANGE_DAILY_LIMIT) {
    throw new AppError(
      'You have reached the daily password change limit. Please wait until tomorrow before changing it again.',
      429,
      'PASSWORD_CHANGE_LIMIT_EXCEEDED'
    );
  }
}

export function getPasswordChangeAlertThreshold(now = new Date()): Date {
  return subtractMilliseconds(now, AUTH_CONFIG.PASSWORD_CHANGE_ALERT_DELAY_MS);
}
