import { randomUUID } from 'crypto';
import { describe, expect, it } from 'vitest';
import { buildApp } from '../../app';
import prisma from '../../config/database';
import { devOtpPreviewService } from '../../shared/devtools/otp-preview.service';
import { hashPassword } from '../../shared/utils/hash';
import { generateTokens } from '../../shared/utils/jwt';

const runIntegration = process.env.RUN_INTEGRATION_TESTS === 'true';
const describeE2E = runIntegration ? describe : describe.skip;
const originalDevOtpEnv = {
  DEV_OTP_PREVIEW_ENABLED: process.env.DEV_OTP_PREVIEW_ENABLED,
  DEV_TOOLS_TOKEN: process.env.DEV_TOOLS_TOKEN
};

interface AdminFixture {
  userIds: number[];
}

function uniqueToken(prefix: string): string {
  return `${prefix}-${Date.now()}-${randomUUID().slice(0, 8)}`;
}

async function createUserFixture(
  fixture: AdminFixture,
  input: Partial<{
    email: string;
    password: string;
    role: 'USER' | 'ADMIN' | 'SUPERADMIN';
  }> = {}
) {
  const password = input.password || 'SecurePass123!';
  const user = await prisma.user.create({
    data: {
      email: input.email || `${uniqueToken('admin-step-up-user')}@example.com`,
      passwordHash: await hashPassword(password),
      fullName: uniqueToken('Admin Step Up Fixture'),
      isVerified: true,
      role: input.role ?? 'USER'
    }
  });

  fixture.userIds.push(user.id);
  return { user, password };
}

async function createAuthHeader(
  user: { id: number; email: string; role: string },
  input: Partial<{
    deviceId: string;
    authPolicyVersion: number;
    tokenVersion: number;
  }> = {}
): Promise<string> {
  const deviceId = input.deviceId || uniqueToken('admin-step-up-device');
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

async function cleanupFixture(fixture: AdminFixture): Promise<void> {
  if (fixture.userIds.length === 0) return;

  await prisma.idempotencyRecord.deleteMany({
    where: { userId: { in: fixture.userIds } }
  });

  await prisma.adminStepUpChallenge.deleteMany({
    where: { actorId: { in: fixture.userIds } }
  });

  await prisma.adminAuditLog.deleteMany({
    where: { actorId: { in: fixture.userIds } }
  });

  await prisma.auditLog.deleteMany({
    where: { userId: { in: fixture.userIds } }
  });

  await prisma.userSession.deleteMany({
    where: { userId: { in: fixture.userIds } }
  });

  await prisma.user.deleteMany({
    where: { id: { in: fixture.userIds } }
  });
}

describeE2E('Admin step-up authorization (HTTP e2e)', () => {
  it('issues and verifies a short-lived superadmin step-up challenge for the current session', async () => {
    const fixture: AdminFixture = { userIds: [] };
    process.env.DEV_OTP_PREVIEW_ENABLED = 'true';
    process.env.DEV_TOOLS_TOKEN = 'integration-dev-tools-token';
    const app = await buildApp();

    try {
      const { user: superadmin } = await createUserFixture(fixture, {
        role: 'SUPERADMIN'
      });
      const authHeader = await createAuthHeader(superadmin);

      const requestResponse = await app.inject({
        method: 'POST',
        url: '/api/admin/step-up/request',
        headers: {
          authorization: authHeader
        }
      });

      expect(requestResponse.statusCode).toBe(200);
      const challenge = requestResponse.json();
      expect(challenge.challengeId).toBeTruthy();
      expect(challenge.otpPreview).toBeUndefined();

      const previewsResponse = await app.inject({
        method: 'GET',
        url: `/internal/dev/otp-previews?email=${encodeURIComponent(superadmin.email)}&emailType=ADMIN_STEP_UP_OTP&limit=1`,
        headers: {
          'x-dev-tools-token': process.env.DEV_TOOLS_TOKEN as string
        }
      });

      expect(previewsResponse.statusCode).toBe(200);
      const previewsPayload = previewsResponse.json();
      expect(previewsPayload.previews).toHaveLength(1);
      expect(previewsPayload.previews[0].otpCode).toMatch(/^\d{6}$/);

      const verifyResponse = await app.inject({
        method: 'POST',
        url: '/api/admin/step-up/verify',
        headers: {
          authorization: authHeader
        },
        payload: {
          challengeId: challenge.challengeId,
          otp: previewsPayload.previews[0].otpCode
        }
      });

      expect(verifyResponse.statusCode).toBe(200);
      expect(verifyResponse.json().stepUpToken).toHaveLength(64);

      const auditCount = await prisma.adminAuditLog.count({
        where: {
          actorId: superadmin.id,
          action: {
            in: ['STEP_UP_CHALLENGE_REQUESTED', 'STEP_UP_CHALLENGE_VERIFIED']
          }
        }
      });

      expect(auditCount).toBe(2);
    } finally {
      await devOtpPreviewService.clear({});
      await cleanupFixture(fixture);
      process.env.DEV_OTP_PREVIEW_ENABLED = originalDevOtpEnv.DEV_OTP_PREVIEW_ENABLED;
      process.env.DEV_TOOLS_TOKEN = originalDevOtpEnv.DEV_TOOLS_TOKEN;
      await app.close();
    }
  }, 120000);

  it('rejects invalid step-up OTP verification attempts and writes a failure audit record', async () => {
    const fixture: AdminFixture = { userIds: [] };
    process.env.DEV_OTP_PREVIEW_ENABLED = 'true';
    process.env.DEV_TOOLS_TOKEN = 'integration-dev-tools-token';
    const app = await buildApp();

    try {
      const { user: superadmin } = await createUserFixture(fixture, {
        role: 'SUPERADMIN'
      });
      const authHeader = await createAuthHeader(superadmin);

      const requestResponse = await app.inject({
        method: 'POST',
        url: '/api/admin/step-up/request',
        headers: {
          authorization: authHeader
        }
      });

      const challenge = requestResponse.json();

      const verifyResponse = await app.inject({
        method: 'POST',
        url: '/api/admin/step-up/verify',
        headers: {
          authorization: authHeader
        },
        payload: {
          challengeId: challenge.challengeId,
          otp: '000000'
        }
      });

      expect(verifyResponse.statusCode).toBe(400);
      expect(verifyResponse.json().error.code).toBe('ADMIN_STEP_UP_INVALID_OTP');

      const failureAudit = await prisma.adminAuditLog.findFirst({
        where: {
          actorId: superadmin.id,
          action: 'STEP_UP_CHALLENGE_FAILED',
          targetId: challenge.challengeId
        }
      });

      expect(failureAudit).not.toBeNull();
    } finally {
      await devOtpPreviewService.clear({});
      await cleanupFixture(fixture);
      process.env.DEV_OTP_PREVIEW_ENABLED = originalDevOtpEnv.DEV_OTP_PREVIEW_ENABLED;
      process.env.DEV_TOOLS_TOKEN = originalDevOtpEnv.DEV_TOOLS_TOKEN;
      await app.close();
    }
  }, 120000);

  it('requires a verified step-up token before allowing sensitive superadmin premium mutations', async () => {
    const fixture: AdminFixture = { userIds: [] };
    process.env.DEV_OTP_PREVIEW_ENABLED = 'true';
    process.env.DEV_TOOLS_TOKEN = 'integration-dev-tools-token';
    const app = await buildApp();

    try {
      const { user: superadmin } = await createUserFixture(fixture, {
        role: 'SUPERADMIN'
      });
      const { user: targetUser } = await createUserFixture(fixture, {
        role: 'USER'
      });
      const authHeader = await createAuthHeader(superadmin);

      const response = await app.inject({
        method: 'POST',
        url: `/api/admin/users/${targetUser.id}/premium/grants`,
        headers: {
          authorization: authHeader,
          'idempotency-key': uniqueToken('admin-step-up-missing')
        },
        payload: {
          kind: 'MANUAL',
          durationDays: 7,
          note: 'Support-issued premium grant requiring explicit superadmin approval.'
        }
      });

      expect(response.statusCode).toBe(403);
      expect(response.json().error.code).toBe('ADMIN_STEP_UP_REQUIRED');
    } finally {
      await devOtpPreviewService.clear({});
      await cleanupFixture(fixture);
      process.env.DEV_OTP_PREVIEW_ENABLED = originalDevOtpEnv.DEV_OTP_PREVIEW_ENABLED;
      process.env.DEV_TOOLS_TOKEN = originalDevOtpEnv.DEV_TOOLS_TOKEN;
      await app.close();
    }
  }, 120000);
});
