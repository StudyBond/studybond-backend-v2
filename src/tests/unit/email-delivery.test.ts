import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const originalEnv = { ...process.env };

function createJsonResponse(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'content-type': 'application/json'
    }
  });
}

async function loadEmailService() {
  vi.resetModules();
  const prismaMock = {
    emailLog: {
      create: vi.fn().mockResolvedValue({})
    },
    systemSettings: {
      findUnique: vi.fn().mockResolvedValue({ emailEnabled: true })
    }
  };

  vi.doMock('../../config/database', () => ({
    default: prismaMock,
    prisma: prismaMock
  }));

  const emailModule = await import('../../shared/email/email.service');
  return {
    prisma: prismaMock,
    transactionalEmailService: emailModule.transactionalEmailService
  };
}

describe('transactional email service', () => {
  beforeEach(() => {
    process.env = { ...originalEnv };
    process.env.NODE_ENV = 'test';
    process.env.EMAIL_FROM_NAME = 'StudyBond';
    process.env.EMAIL_FROM_ADDRESS = 'no-reply@studybond.test';
    process.env.EMAIL_PROVIDER_TIMEOUT_MS = '1000';
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.env = { ...originalEnv };
  });

  it('uses Brevo as the primary provider when Brevo succeeds', async () => {
    process.env.BREVO_API_KEY = 'brevo-key';
    process.env.RESEND_API_KEY = 'resend-key';

    const fetchMock = vi.fn(async () => createJsonResponse(201, { messageId: 'brevo-123' }));
    vi.stubGlobal('fetch', fetchMock);

    const { prisma, transactionalEmailService } = await loadEmailService();
    const emailLogSpy = prisma.emailLog.create;

    const result = await transactionalEmailService.send({
      userId: 1,
      emailType: 'VERIFICATION_OTP' as any,
      to: { email: 'user@example.com', name: 'Test User' },
      subject: 'Verify',
      html: '<p>Hello</p>',
      text: 'Hello',
      isCritical: true
    });

    expect(result.deliveryMode).toBe('BREVO');
    expect(result.provider).toBe('BREVO');
    expect(result.fallbackUsed).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(emailLogSpy).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        provider: 'BREVO',
        status: 'sent'
      })
    }));
  });

  it('falls back to Resend when Brevo fails with a retryable error', async () => {
    process.env.BREVO_API_KEY = 'brevo-key';
    process.env.RESEND_API_KEY = 'resend-key';

    const fetchMock = vi.fn()
      .mockImplementationOnce(async () => createJsonResponse(503, { code: 'temporarily_unavailable', message: 'down' }))
      .mockImplementationOnce(async () => createJsonResponse(200, { id: 'resend-456' }));
    vi.stubGlobal('fetch', fetchMock);

    const { prisma, transactionalEmailService } = await loadEmailService();
    const emailLogSpy = prisma.emailLog.create;

    const result = await transactionalEmailService.send({
      userId: 2,
      emailType: 'DEVICE_VERIFICATION_OTP' as any,
      to: { email: 'user@example.com', name: 'Test User' },
      subject: 'Verify device',
      html: '<p>Hello</p>',
      text: 'Hello',
      isCritical: true
    });

    expect(result.deliveryMode).toBe('RESEND');
    expect(result.provider).toBe('RESEND');
    expect(result.fallbackUsed).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(emailLogSpy).toHaveBeenCalledTimes(2);
    expect(emailLogSpy.mock.calls[0]?.[0]).toEqual(expect.objectContaining({
      data: expect.objectContaining({
        provider: 'BREVO',
        status: 'failed'
      })
    }));
    expect(emailLogSpy.mock.calls[1]?.[0]).toEqual(expect.objectContaining({
      data: expect.objectContaining({
        provider: 'RESEND',
        status: 'sent'
      })
    }));
  });

  it('returns a deterministic preview delivery in non-production when no providers are configured', async () => {
    delete process.env.BREVO_API_KEY;
    delete process.env.RESEND_API_KEY;

    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const { prisma, transactionalEmailService } = await loadEmailService();
    const emailLogSpy = prisma.emailLog.create;

    const result = await transactionalEmailService.send({
      userId: 3,
      emailType: 'ADMIN_STEP_UP_OTP' as any,
      to: { email: 'admin@example.com', name: 'Admin User' },
      subject: 'Admin approval',
      html: '<p>Hello</p>',
      text: 'Hello',
      isCritical: true,
      debugPreviewCode: '123456'
    });

    expect(result.deliveryMode).toBe('DEV_PREVIEW');
    expect(result.previewCode).toBe('123456');
    expect(result.provider).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(emailLogSpy).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        provider: null,
        status: 'preview'
      })
    }));
  });
});
