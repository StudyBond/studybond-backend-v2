import { EmailProvider, Prisma } from '@prisma/client';
import prisma from '../../config/database';
import { AppError } from '../errors/AppError';
import { getGlobalMetricsRegistry } from '../metrics/global';
import { EmailProviderError } from './email-provider-error';
import {
  EmailProviderClient,
  EmailProviderName,
  TransactionalEmailInput,
  TransactionalEmailSendResult
} from './email.types';
import { devOtpPreviewService } from '../devtools/otp-preview.service';
import { BrevoEmailProvider } from './providers/brevo.provider';
import { ResendEmailProvider } from './providers/resend.provider';

function mapProvider(provider: EmailProviderName): EmailProvider {
  return provider === 'BREVO' ? EmailProvider.BREVO : EmailProvider.RESEND;
}

function shouldFallback(error: EmailProviderError): boolean {
  return error.retryable;
}

function isDevPreviewAllowed(): boolean {
  return process.env.NODE_ENV !== 'production';
}

export class TransactionalEmailService {
  private readonly providers: EmailProviderClient[] = [
    new BrevoEmailProvider(),
    new ResendEmailProvider()
  ];

  private getMetrics() {
    return getGlobalMetricsRegistry();
  }

  private recordAttemptMetric(
    provider: EmailProviderName | 'DEV_PREVIEW',
    status: 'sent' | 'failed' | 'preview' | 'suppressed',
    emailType: string
  ): void {
    const metrics = this.getMetrics();
    if (!metrics) return;

    metrics.incrementCounter('email_delivery_attempts_total', 1, {
      provider,
      status,
      emailType
    });
  }

  private recordDurationMetric(
    provider: EmailProviderName,
    status: 'sent' | 'failed',
    emailType: string,
    durationMs: number
  ): void {
    const metrics = this.getMetrics();
    if (!metrics) return;

    metrics.observeHistogram('email_delivery_duration_ms', durationMs, {
      provider,
      status,
      emailType
    });
  }

  private async writeEmailLog(input: TransactionalEmailInput, entry: {
    provider?: EmailProviderName;
    status: string;
    emailServiceId?: string;
    errorMessage?: string;
    metadata?: Prisma.InputJsonValue;
  }): Promise<void> {
    try {
      await prisma.emailLog.create({
        data: {
          userId: input.userId,
          emailType: input.emailType,
          provider: entry.provider ? mapProvider(entry.provider) : null,
          recipientEmail: input.to.email,
          subject: input.subject,
          status: entry.status,
          emailServiceId: entry.emailServiceId,
          errorMessage: entry.errorMessage,
          metadata: entry.metadata
        }
      });
    } catch (error) {
      console.error('[EMAIL_LOG_FAILURE]', {
        userId: input.userId,
        emailType: input.emailType,
        provider: entry.provider,
        status: entry.status,
        error
      });
    }
  }

  private async isEmailSystemEnabled(): Promise<boolean> {
    const settings = await prisma.systemSettings.findUnique({
      where: { id: 1 },
      select: { emailEnabled: true }
    });

    return settings?.emailEnabled ?? true;
  }

  private async previewSend(input: TransactionalEmailInput): Promise<TransactionalEmailSendResult> {
    await this.writeEmailLog(input, {
      status: 'preview',
      metadata: {
        mode: 'DEV_PREVIEW'
      }
    });

    this.recordAttemptMetric('DEV_PREVIEW', 'preview', input.emailType);
    await this.recordOtpPreview(input, 'DEV_PREVIEW');
    return {
      deliveryMode: 'DEV_PREVIEW',
      provider: null,
      fallbackUsed: false,
      attempts: [],
      previewCode: input.debugPreviewCode
    };
  }

  private async recordOtpPreview(
    input: TransactionalEmailInput,
    deliveryMode: 'BREVO' | 'RESEND' | 'DEV_PREVIEW'
  ): Promise<void> {
    try {
      await devOtpPreviewService.recordFromEmail(input, deliveryMode);
    } catch (error) {
      console.error('[DEV_OTP_PREVIEW_RECORD_FAILURE]', {
        userId: input.userId,
        emailType: input.emailType,
        deliveryMode,
        error
      });
    }
  }

  async send(input: TransactionalEmailInput): Promise<TransactionalEmailSendResult> {
    const emailEnabled = await this.isEmailSystemEnabled();
    if (!emailEnabled && !input.isCritical) {
      await this.writeEmailLog(input, {
        status: 'suppressed',
        metadata: {
          reasonCode: 'EMAIL_SYSTEM_DISABLED'
        }
      });

      this.recordAttemptMetric('DEV_PREVIEW', 'suppressed', input.emailType);
      return {
        deliveryMode: 'SUPPRESSED',
        provider: null,
        fallbackUsed: false,
        attempts: []
      };
    }

    const availableProviders = this.providers.filter((provider) => provider.isConfigured());
    if (availableProviders.length === 0) {
      if (isDevPreviewAllowed()) {
        return this.previewSend(input);
      }

      throw new AppError(
        'Email delivery is not configured. Please contact support or try again later.',
        503,
        'EMAIL_DELIVERY_UNAVAILABLE'
      );
    }

    const attempts: TransactionalEmailSendResult['attempts'] = [];

    for (let index = 0; index < availableProviders.length; index += 1) {
      const provider = availableProviders[index];
      const startedAt = Date.now();

      try {
        const result = await provider.send({
          to: input.to,
          subject: input.subject,
          html: input.html,
          text: input.text
        });

        attempts.push({
          provider: result.provider,
          ok: true
        });

        const fallbackUsed = attempts.some((attempt) => !attempt.ok);
        await this.writeEmailLog(input, {
          provider: result.provider,
          status: 'sent',
          emailServiceId: result.messageId,
          metadata: {
            fallbackUsed,
            attemptCount: attempts.length + 1
          }
        });

        this.recordAttemptMetric(result.provider, 'sent', input.emailType);
        this.recordDurationMetric(result.provider, 'sent', input.emailType, Date.now() - startedAt);
        await this.recordOtpPreview(input, result.provider);

        if (fallbackUsed) {
          const metrics = this.getMetrics();
          if (metrics) {
            metrics.incrementCounter('email_delivery_fallback_total', 1, {
              from: attempts.find((attempt) => !attempt.ok)?.provider || 'UNKNOWN',
              to: result.provider,
              emailType: input.emailType
            });
          }
        }

        return {
          deliveryMode: result.provider,
          provider: result.provider,
          messageId: result.messageId,
          fallbackUsed,
          attempts
        };
      } catch (error) {
        const providerError = error instanceof EmailProviderError
          ? error
          : new EmailProviderError((error as Error).message || 'Email provider request failed unexpectedly.');

        attempts.push({
          provider: provider.name,
          ok: false,
          statusCode: providerError.statusCode,
          errorCode: providerError.code,
          errorMessage: providerError.message
        });

        await this.writeEmailLog(input, {
          provider: provider.name,
          status: 'failed',
          errorMessage: providerError.message,
          metadata: {
            code: providerError.code,
            statusCode: providerError.statusCode,
            retryable: providerError.retryable
          }
        });

        this.recordAttemptMetric(provider.name, 'failed', input.emailType);
        this.recordDurationMetric(provider.name, 'failed', input.emailType, Date.now() - startedAt);

        const isLastProvider = index === availableProviders.length - 1;
        if (isLastProvider || !shouldFallback(providerError)) {
          throw new AppError(
            'We could not send that email right now. Please try again in a moment.',
            503,
            'EMAIL_DELIVERY_FAILED',
            {
              attempts
            }
          );
        }
      }
    }

    throw new AppError(
      'We could not send that email right now. Please try again in a moment.',
      503,
      'EMAIL_DELIVERY_FAILED',
      {
        attempts
      }
    );
  }
}

export const transactionalEmailService = new TransactionalEmailService();
