import { randomUUID } from 'crypto';
import { describe, expect, it } from 'vitest';
import { buildApp } from '../../app';
import prisma from '../../config/database';
import { hashPassword } from '../../shared/utils/hash';
import { generateTokens } from '../../shared/utils/jwt';

const runIntegration = process.env.RUN_INTEGRATION_TESTS === 'true';
const describeE2E = runIntegration ? describe : describe.skip;

interface ReportsFixture {
  userIds: number[];
  questionIds: number[];
}

function uniqueToken(prefix: string): string {
  return `${prefix}-${Date.now()}-${randomUUID().slice(0, 8)}`;
}

async function createUserFixture(
  fixture: ReportsFixture,
  input: Partial<{
    email: string;
    password: string;
    role: 'USER' | 'ADMIN' | 'SUPERADMIN';
  }> = {}
) {
  const password = input.password || 'SecurePass123!';
  const user = await prisma.user.create({
    data: {
      email: input.email || `${uniqueToken('report-user')}@example.com`,
      passwordHash: await hashPassword(password),
      fullName: uniqueToken('Reports Fixture User'),
      isVerified: true,
      role: input.role ?? 'USER'
    }
  });

  fixture.userIds.push(user.id);
  return { user, password };
}

async function createAuthHeader(
  user: { id: number; email: string; role: string },
  input: Partial<{ deviceId: string; authPolicyVersion: number; tokenVersion: number }> = {}
): Promise<string> {
  const deviceId = input.deviceId || uniqueToken('reports-device');
  const session = await prisma.userSession.create({
    data: {
      userId: user.id,
      deviceId,
      isActive: true,
      authPolicyVersion: input.authPolicyVersion ?? 0,
      tokenVersion: input.tokenVersion ?? 0,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000)
    }
  });

  const tokens = generateTokens(
    {
      id: user.id,
      email: user.email,
      role: user.role
    },
    session.id,
    deviceId,
    session.tokenVersion
  );

  return `Bearer ${tokens.accessToken}`;
}

async function createQuestionFixture(fixture: ReportsFixture, input: Partial<{ subject: string; questionPool: 'FREE_EXAM' | 'REAL_BANK' | 'PRACTICE' }> = {}) {
  const question = await prisma.question.create({
    data: {
      questionText: `${uniqueToken('report-question')} What is the correct answer?`,
      optionA: 'Option A',
      optionB: 'Option B',
      optionC: 'Option C',
      optionD: 'Option D',
      correctAnswer: 'A',
      subject: input.subject || 'Biology',
      topic: 'Cells',
      questionType: 'real_past_question',
      questionPool: input.questionPool || 'REAL_BANK'
    }
  });

  fixture.questionIds.push(question.id);
  return question;
}

async function cleanupFixture(fixture: ReportsFixture): Promise<void> {
  if (fixture.questionIds.length > 0) {
    await prisma.questionReport.deleteMany({
      where: {
        OR: [
          { questionId: { in: fixture.questionIds } },
          { userId: { in: fixture.userIds } }
        ]
      }
    });
  }

  await prisma.adminAuditLog.deleteMany({
    where: {
      OR: [
        { actorId: { in: fixture.userIds } },
        { targetType: 'REPORT' }
      ]
    }
  });

  await prisma.auditLog.deleteMany({
    where: { userId: { in: fixture.userIds } }
  });

  await prisma.userSession.deleteMany({
    where: { userId: { in: fixture.userIds } }
  });

  if (fixture.questionIds.length > 0) {
    await prisma.question.deleteMany({
      where: { id: { in: fixture.questionIds } }
    });
  }

  if (fixture.userIds.length > 0) {
    await prisma.user.deleteMany({
      where: { id: { in: fixture.userIds } }
    });
  }
}

describeE2E('Reports module (HTTP e2e)', () => {
  it('lets a user create, list, fetch, and delete a pending report', async () => {
    const fixture: ReportsFixture = { userIds: [], questionIds: [] };
    const app = await buildApp();

    try {
      const { user } = await createUserFixture(fixture);
      const question = await createQuestionFixture(fixture);
      const authHeader = await createAuthHeader(user);

      const createResponse = await app.inject({
        method: 'POST',
        url: '/api/reports',
        headers: {
          authorization: authHeader
        },
        payload: {
          questionId: question.id,
          issueType: 'WRONG_ANSWER',
          description: 'The marked answer does not match the explanation.'
        }
      });

      expect(createResponse.statusCode).toBe(201);
      const created = createResponse.json().data;

      const listResponse = await app.inject({
        method: 'GET',
        url: '/api/reports',
        headers: {
          authorization: authHeader
        }
      });

      expect(listResponse.statusCode).toBe(200);
      expect(listResponse.json().data.reports).toHaveLength(1);

      const getResponse = await app.inject({
        method: 'GET',
        url: `/api/reports/${created.id}`,
        headers: {
          authorization: authHeader
        }
      });

      expect(getResponse.statusCode).toBe(200);
      expect(getResponse.json().data.status).toBe('PENDING');

      const deleteResponse = await app.inject({
        method: 'DELETE',
        url: `/api/reports/${created.id}`,
        headers: {
          authorization: authHeader
        }
      });

      expect(deleteResponse.statusCode).toBe(200);

      const deletedReport = await prisma.questionReport.findUnique({
        where: { id: created.id }
      });

      expect(deletedReport).toBeNull();
    } finally {
      await cleanupFixture(fixture);
      await app.close();
    }
  }, 120000);

  it('blocks duplicate reports for the same issue type but allows a different issue type', async () => {
    const fixture: ReportsFixture = { userIds: [], questionIds: [] };
    const app = await buildApp();

    try {
      const { user } = await createUserFixture(fixture);
      const question = await createQuestionFixture(fixture);
      const authHeader = await createAuthHeader(user);

      const firstResponse = await app.inject({
        method: 'POST',
        url: '/api/reports',
        headers: {
          authorization: authHeader
        },
        payload: {
          questionId: question.id,
          issueType: 'TYPO',
          description: 'There is a typo in option C.'
        }
      });

      const duplicateResponse = await app.inject({
        method: 'POST',
        url: '/api/reports',
        headers: {
          authorization: authHeader
        },
        payload: {
          questionId: question.id,
          issueType: 'TYPO',
          description: 'Still the same typo.'
        }
      });

      const differentIssueResponse = await app.inject({
        method: 'POST',
        url: '/api/reports',
        headers: {
          authorization: authHeader
        },
        payload: {
          questionId: question.id,
          issueType: 'AMBIGUOUS',
          description: 'The wording is ambiguous too.'
        }
      });

      expect(firstResponse.statusCode).toBe(201);
      expect(duplicateResponse.statusCode).toBe(409);
      expect(differentIssueResponse.statusCode).toBe(201);
    } finally {
      await cleanupFixture(fixture);
      await app.close();
    }
  }, 120000);

  it('lets admins review and resolve reports through the moderation queue', async () => {
    const fixture: ReportsFixture = { userIds: [], questionIds: [] };
    const app = await buildApp();

    try {
      const { user: admin } = await createUserFixture(fixture, { role: 'ADMIN' });
      const { user: reporter } = await createUserFixture(fixture);
      const question = await createQuestionFixture(fixture, { subject: 'Chemistry' });
      const adminAuthHeader = await createAuthHeader(admin);
      const reporterAuthHeader = await createAuthHeader(reporter);

      const createResponse = await app.inject({
        method: 'POST',
        url: '/api/reports',
        headers: {
          authorization: reporterAuthHeader
        },
        payload: {
          questionId: question.id,
          issueType: 'IMAGE_MISSING',
          description: 'The question references an image but no image is attached.'
        }
      });

      const reportId = createResponse.json().data.id;

      const queueResponse = await app.inject({
        method: 'GET',
        url: '/api/admin/reports?status=PENDING&subject=Chemistry',
        headers: {
          authorization: adminAuthHeader
        }
      });

      expect(queueResponse.statusCode).toBe(200);
      expect(queueResponse.json().data.summary.pending).toBeGreaterThanOrEqual(1);

      const reviewResponse = await app.inject({
        method: 'PATCH',
        url: `/api/admin/reports/${reportId}/status`,
        headers: {
          authorization: adminAuthHeader
        },
        payload: {
          status: 'REVIEWED',
          adminNote: 'Checked the question and queued the image fix.'
        }
      });

      expect(reviewResponse.statusCode).toBe(200);
      expect(reviewResponse.json().data.status).toBe('REVIEWED');

      const resolveResponse = await app.inject({
        method: 'PATCH',
        url: `/api/admin/reports/${reportId}/status`,
        headers: {
          authorization: adminAuthHeader
        },
        payload: {
          status: 'RESOLVED',
          adminNote: 'Image has been added and the question is now correct.'
        }
      });

      expect(resolveResponse.statusCode).toBe(200);
      expect(resolveResponse.json().data.status).toBe('RESOLVED');

      const refreshedReport = await prisma.questionReport.findUniqueOrThrow({
        where: { id: reportId },
        select: {
          status: true,
          reviewedByAdminId: true,
          resolvedByAdminId: true,
          adminNote: true
        }
      });
      const auditCount = await prisma.adminAuditLog.count({
        where: {
          actorId: admin.id,
          targetType: 'REPORT',
          targetId: String(reportId)
        }
      });

      expect(refreshedReport.status).toBe('RESOLVED');
      expect(refreshedReport.reviewedByAdminId).toBe(admin.id);
      expect(refreshedReport.resolvedByAdminId).toBe(admin.id);
      expect(refreshedReport.adminNote).toContain('Image has been added');
      expect(auditCount).toBe(2);
    } finally {
      await cleanupFixture(fixture);
      await app.close();
    }
  }, 120000);

  it('allows only superadmins to hard delete reports', async () => {
    const fixture: ReportsFixture = { userIds: [], questionIds: [] };
    const app = await buildApp();

    try {
      const { user: admin } = await createUserFixture(fixture, { role: 'ADMIN' });
      const { user: superadmin } = await createUserFixture(fixture, { role: 'SUPERADMIN' });
      const { user: reporter } = await createUserFixture(fixture);
      const question = await createQuestionFixture(fixture);
      const adminAuthHeader = await createAuthHeader(admin);
      const superadminAuthHeader = await createAuthHeader(superadmin);
      const reporterAuthHeader = await createAuthHeader(reporter);

      const createResponse = await app.inject({
        method: 'POST',
        url: '/api/reports',
        headers: {
          authorization: reporterAuthHeader
        },
        payload: {
          questionId: question.id,
          issueType: 'OTHER',
          description: 'This is a duplicate spam report that should be purged.'
        }
      });

      const reportId = createResponse.json().data.id;

      const adminDeleteResponse = await app.inject({
        method: 'DELETE',
        url: `/api/admin/reports/${reportId}/hard-delete`,
        headers: {
          authorization: adminAuthHeader
        },
        payload: {
          reason: 'Trying to hard delete without superadmin access.'
        }
      });

      const superadminDeleteResponse = await app.inject({
        method: 'DELETE',
        url: `/api/admin/reports/${reportId}/hard-delete`,
        headers: {
          authorization: superadminAuthHeader
        },
        payload: {
          reason: 'Confirmed invalid duplicate report and purged it.'
        }
      });

      expect(adminDeleteResponse.statusCode).toBe(403);
      expect(superadminDeleteResponse.statusCode).toBe(200);

      const deletedReport = await prisma.questionReport.findUnique({
        where: { id: reportId }
      });
      const auditLog = await prisma.adminAuditLog.findFirst({
        where: {
          actorId: superadmin.id,
          action: 'REPORT_HARD_DELETED',
          targetType: 'REPORT',
          targetId: String(reportId)
        }
      });

      expect(deletedReport).toBeNull();
      expect(auditLog).not.toBeNull();
    } finally {
      await cleanupFixture(fixture);
      await app.close();
    }
  }, 120000);
});
