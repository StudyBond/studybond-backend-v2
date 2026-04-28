import { EmailType } from '@prisma/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setCacheAdapter } from '../../shared/cache/cache';
import { DevOtpPreviewService } from '../../shared/devtools/otp-preview.service';

const originalEnv = { ...process.env };

describe('dev OTP preview service', () => {
  beforeEach(() => {
    process.env = {
      ...originalEnv,
      NODE_ENV: 'test',
      DEV_OTP_PREVIEW_ENABLED: 'true',
      DEV_TOOLS_TOKEN: 'unit-test-dev-tools-token'
    };

    setCacheAdapter({
      available: false,
      async get() { return null; },
      async set() { return; },
      async del() { return; },
      async delMany() { return; },
      async incr() { return 0; },
      async expire() { return; },
      async acquireLock() { return true; },
      async releaseLock() { return; }
    });
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('records and lists OTP previews in memory when enabled', async () => {
    const service = new DevOtpPreviewService();

    await service.recordFromEmail({
      userId: 44,
      emailType: EmailType.PASSWORD_RESET_OTP,
      to: { email: 'User@example.com' },
      subject: 'Reset your password',
      html: '<p>123456</p>',
      text: '123456',
      debugPreviewCode: '123456',
      metadata: {
        reason: 'password_reset'
      }
    }, 'DEV_PREVIEW');

    const previews = await service.list({
      email: 'user@example.com',
      emailType: EmailType.PASSWORD_RESET_OTP,
      limit: 1
    });

    expect(previews).toHaveLength(1);
    expect(previews[0]).toEqual(expect.objectContaining({
      userId: 44,
      email: 'user@example.com',
      emailType: EmailType.PASSWORD_RESET_OTP,
      otpCode: '123456',
      deliveryMode: 'DEV_PREVIEW'
    }));
  });

  it('requires a valid dev tools token and does not enable previews in production', () => {
    const service = new DevOtpPreviewService();

    expect(service.isEnabled()).toBe(true);
    expect(service.isAuthorized('unit-test-dev-tools-token')).toBe(true);
    expect(service.isAuthorized('wrong-token-value')).toBe(false);

    process.env.NODE_ENV = 'production';
    expect(service.isEnabled()).toBe(false);
    expect(service.isAuthorized('unit-test-dev-tools-token')).toBe(false);
  });
});
