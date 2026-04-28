import { randomUUID } from 'crypto';
import { describe, expect, it } from 'vitest';
import { buildApp } from '../../app';
import prisma from '../../config/database';
import { devOtpPreviewService } from '../../shared/devtools/otp-preview.service';
import { hashPassword } from '../../shared/utils/hash';

const runIntegration = process.env.RUN_INTEGRATION_TESTS === 'true';
const describeE2E = runIntegration ? describe : describe.skip;
const originalDevOtpEnv = {
  DEV_OTP_PREVIEW_ENABLED: process.env.DEV_OTP_PREVIEW_ENABLED,
  DEV_TOOLS_TOKEN: process.env.DEV_TOOLS_TOKEN
};

interface DevOtpFixture {
  userIds: number[];
}

function uniqueToken(prefix: string): string {
  return `${prefix}-${Date.now()}-${randomUUID().slice(0, 8)}`;
}

function isTransientDbError(error: unknown): boolean {
  const message = String((error as Error | undefined)?.message || error || '').toLowerCase();
  return (
    message.includes('operation has timed out') ||
    message.includes('server has closed the connection') ||
    message.includes('connection terminated unexpectedly') ||
    message.includes("can't reach database server")
  );
}

async function withTransientDbRetry<T>(operation: () => Promise<T>, attempts = 3): Promise<T> {
  let lastError: unknown;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (!isTransientDbError(error) || attempt === attempts - 1) {
        throw error;
      }

      await new Promise((resolve) => setTimeout(resolve, 750 * (attempt + 1)));
    }
  }

  throw lastError;
}

async function createVerifiedUser(fixture: DevOtpFixture) {
  const user = await withTransientDbRetry(async () => prisma.user.create({
    data: {
      email: `${uniqueToken('dev-otp-user')}@example.com`,
      passwordHash: await hashPassword('SecurePass123!'),
      fullName: uniqueToken('Dev OTP User'),
      isVerified: true
    }
  }));

  fixture.userIds.push(user.id);
  return user;
}

async function cleanupFixture(fixture: DevOtpFixture): Promise<void> {
  if (fixture.userIds.length === 0) return;

  await prisma.emailLog.deleteMany({
    where: { userId: { in: fixture.userIds } }
  });

  await prisma.auditLog.deleteMany({
    where: { userId: { in: fixture.userIds } }
  });

  await prisma.userSession.deleteMany({
    where: { userId: { in: fixture.userIds } }
  });

  await prisma.userDevice.deleteMany({
    where: { userId: { in: fixture.userIds } }
  });

  await prisma.user.deleteMany({
    where: { id: { in: fixture.userIds } }
  });
}

describeE2E('Dev OTP preview center (HTTP e2e)', () => {
  it('returns the latest password reset OTP preview through the guarded dev-only route', async () => {
    const fixture: DevOtpFixture = { userIds: [] };
    process.env.DEV_OTP_PREVIEW_ENABLED = 'true';
    process.env.DEV_TOOLS_TOKEN = 'integration-dev-tools-token';
    const app = await buildApp();

    try {
      const user = await createVerifiedUser(fixture);

      const forgotResponse = await app.inject({
        method: 'POST',
        url: '/api/auth/forgot-password',
        payload: {
          email: user.email
        }
      });

      expect(forgotResponse.statusCode).toBe(200);

      const previewResponse = await app.inject({
        method: 'GET',
        url: `/internal/dev/otp-previews?email=${encodeURIComponent(user.email)}&emailType=PASSWORD_RESET_OTP&limit=1`,
        headers: {
          'x-dev-tools-token': process.env.DEV_TOOLS_TOKEN as string
        }
      });

      expect(previewResponse.statusCode).toBe(200);
      expect(previewResponse.json()).toEqual({
        previews: [
          expect.objectContaining({
            email: user.email.toLowerCase(),
            emailType: 'PASSWORD_RESET_OTP',
            deliveryMode: 'DEV_PREVIEW',
            otpCode: expect.stringMatching(/^\d{6}$/)
          })
        ],
        meta: expect.objectContaining({
          count: 1,
          filters: {
            email: user.email,
            emailType: 'PASSWORD_RESET_OTP'
          }
        })
      });
    } finally {
      await devOtpPreviewService.clear({});
      await cleanupFixture(fixture);
      process.env.DEV_OTP_PREVIEW_ENABLED = originalDevOtpEnv.DEV_OTP_PREVIEW_ENABLED;
      process.env.DEV_TOOLS_TOKEN = originalDevOtpEnv.DEV_TOOLS_TOKEN;
      await app.close();
    }
  }, 120000);

  it('rejects requests when the dev tools token is missing or invalid', async () => {
    const fixture: DevOtpFixture = { userIds: [] };
    process.env.DEV_OTP_PREVIEW_ENABLED = 'true';
    process.env.DEV_TOOLS_TOKEN = 'integration-dev-tools-token';
    const app = await buildApp();

    try {
      const response = await app.inject({
        method: 'GET',
        url: '/internal/dev/otp-previews'
      });

      expect(response.statusCode).toBe(401);
      expect(response.json()).toEqual(expect.objectContaining({
        success: false,
        error: expect.objectContaining({
          code: 'DEV_TOOLS_UNAUTHORIZED'
        })
      }));
    } finally {
      await devOtpPreviewService.clear({});
      await cleanupFixture(fixture);
      process.env.DEV_OTP_PREVIEW_ENABLED = originalDevOtpEnv.DEV_OTP_PREVIEW_ENABLED;
      process.env.DEV_TOOLS_TOKEN = originalDevOtpEnv.DEV_TOOLS_TOKEN;
      await app.close();
    }
  }, 120000);

  it('behaves like a hidden route when the preview center is disabled', async () => {
    const fixture: DevOtpFixture = { userIds: [] };
    process.env.DEV_OTP_PREVIEW_ENABLED = 'false';
    process.env.DEV_TOOLS_TOKEN = 'integration-dev-tools-token';
    const app = await buildApp();

    try {
      const response = await app.inject({
        method: 'GET',
        url: '/internal/dev/otp-previews',
        headers: {
          'x-dev-tools-token': 'integration-dev-tools-token'
        }
      });

      expect(response.statusCode).toBe(404);
      expect(response.json()).toEqual(expect.objectContaining({
        success: false,
        error: expect.objectContaining({
          code: 'ROUTE_NOT_FOUND'
        })
      }));
    } finally {
      await devOtpPreviewService.clear({});
      await cleanupFixture(fixture);
      process.env.DEV_OTP_PREVIEW_ENABLED = originalDevOtpEnv.DEV_OTP_PREVIEW_ENABLED;
      process.env.DEV_TOOLS_TOKEN = originalDevOtpEnv.DEV_TOOLS_TOKEN;
      await app.close();
    }
  }, 120000);
});
