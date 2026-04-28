import { AuditAction, EmailType } from '@prisma/client';
import prisma from '../config/database';
import { AUTH_CONFIG } from '../config/constants';
import { getPasswordChangeAlertThreshold } from '../shared/auth/passwordPolicy';
import { transactionalEmailService } from '../shared/email/email.service';
import { buildPasswordChangedAlertTemplate } from '../shared/email/email.templates';

export async function runPasswordChangeAlertCheck(): Promise<{ scannedUsers: number; notifiedUsers: number }> {
  const threshold = getPasswordChangeAlertThreshold();

  const candidates = await prisma.auditLog.findMany({
    where: {
      action: AuditAction.PASSWORD_CHANGED,
      userId: { not: null },
      createdAt: { lte: threshold }
    },
    select: {
      userId: true
    },
    distinct: ['userId'],
    take: AUTH_CONFIG.PASSWORD_CHANGE_ALERT_BATCH_SIZE
  });

  let notifiedUsers = 0;

  for (const candidate of candidates) {
    if (!candidate.userId) {
      continue;
    }

    const [user, lastAlert] = await Promise.all([
      prisma.user.findUnique({
        where: { id: candidate.userId },
        select: {
          id: true,
          email: true,
          fullName: true
        }
      }),
      prisma.emailLog.findFirst({
        where: {
          userId: candidate.userId,
          emailType: EmailType.PASSWORD_CHANGED_ALERT,
          status: {
            in: ['sent', 'preview']
          }
        },
        orderBy: {
          sentAt: 'desc'
        }
      })
    ]);

    if (!user) {
      continue;
    }

    const changesSinceLastAlert = await prisma.auditLog.findMany({
      where: {
        userId: user.id,
        action: AuditAction.PASSWORD_CHANGED,
        createdAt: {
          gt: lastAlert?.sentAt ?? new Date(0)
        }
      },
      select: {
        createdAt: true
      },
      orderBy: {
        createdAt: 'asc'
      }
    });

    if (changesSinceLastAlert.length === 0) {
      continue;
    }

    const latestChange = changesSinceLastAlert[changesSinceLastAlert.length - 1];
    if (latestChange.createdAt > threshold) {
      continue;
    }

    const template = buildPasswordChangedAlertTemplate(
      user.fullName,
      changesSinceLastAlert.length,
      latestChange.createdAt
    );

    await transactionalEmailService.send({
      userId: user.id,
      emailType: EmailType.PASSWORD_CHANGED_ALERT,
      to: {
        email: user.email,
        name: user.fullName
      },
      subject: template.subject,
      html: template.html,
      text: template.text,
      isCritical: true,
      metadata: {
        reason: 'password_change_notice',
        changeCount: changesSinceLastAlert.length,
        latestChangedAt: latestChange.createdAt.toISOString()
      }
    });

    notifiedUsers += 1;
  }

  return {
    scannedUsers: candidates.length,
    notifiedUsers
  };
}
