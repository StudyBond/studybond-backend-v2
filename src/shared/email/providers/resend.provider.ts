import { EMAIL_CONFIG } from '../../../config/constants';
import { EmailProviderClient, EmailProviderSendInput, EmailProviderSendResult } from '../email.types';
import { EmailProviderError } from '../email-provider-error';

function isRetryable(statusCode?: number): boolean {
  if (statusCode === undefined) return true;
  if (statusCode === 400 || statusCode === 422) return false;
  return true;
}

async function readJson(response: Response): Promise<any> {
  const text = await response.text();
  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch {
    return { message: text };
  }
}

export class ResendEmailProvider implements EmailProviderClient {
  readonly name = 'RESEND' as const;

  isConfigured(): boolean {
    return Boolean(EMAIL_CONFIG.RESEND_API_KEY && EMAIL_CONFIG.FROM_ADDRESS);
  }

  async send(input: EmailProviderSendInput): Promise<EmailProviderSendResult> {
    if (!this.isConfigured()) {
      throw new EmailProviderError('Resend is not configured.', {
        code: 'RESEND_NOT_CONFIGURED',
        retryable: true
      });
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), EMAIL_CONFIG.PROVIDER_TIMEOUT_MS);

    try {
      const response = await fetch(EMAIL_CONFIG.RESEND_BASE_URL, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'accept': 'application/json',
          'authorization': `Bearer ${EMAIL_CONFIG.RESEND_API_KEY}`
        },
        body: JSON.stringify({
          from: `${EMAIL_CONFIG.FROM_NAME} <${EMAIL_CONFIG.FROM_ADDRESS}>`,
          to: [input.to.email],
          reply_to: EMAIL_CONFIG.REPLY_TO_ADDRESS,
          subject: input.subject,
          html: input.html,
          text: input.text
        }),
        signal: controller.signal
      });

      const payload = await readJson(response);
      if (!response.ok) {
        const details = payload?.error || payload?.message || payload?.name;
        throw new EmailProviderError(
          typeof details === 'string' ? details : 'Resend rejected the email request.',
          {
            statusCode: response.status,
            code: payload?.name || payload?.code || 'RESEND_REQUEST_FAILED',
            retryable: isRetryable(response.status)
          }
        );
      }

      return {
        provider: this.name,
        messageId: typeof payload?.id === 'string' ? payload.id : undefined
      };
    } catch (error) {
      if (error instanceof EmailProviderError) {
        throw error;
      }

      if ((error as Error).name === 'AbortError') {
        throw new EmailProviderError('Resend request timed out.', {
          code: 'RESEND_TIMEOUT',
          retryable: true
        });
      }

      throw new EmailProviderError((error as Error).message || 'Resend request failed unexpectedly.', {
        code: 'RESEND_NETWORK_ERROR',
        retryable: true
      });
    } finally {
      clearTimeout(timeout);
    }
  }
}
