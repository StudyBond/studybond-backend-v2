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

export class BrevoEmailProvider implements EmailProviderClient {
  readonly name = 'BREVO' as const;

  isConfigured(): boolean {
    return Boolean(EMAIL_CONFIG.BREVO_API_KEY && EMAIL_CONFIG.FROM_ADDRESS);
  }

  async send(input: EmailProviderSendInput): Promise<EmailProviderSendResult> {
    if (!this.isConfigured()) {
      throw new EmailProviderError('Brevo is not configured.', {
        code: 'BREVO_NOT_CONFIGURED',
        retryable: true
      });
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), EMAIL_CONFIG.PROVIDER_TIMEOUT_MS);

    try {
      const response = await fetch(EMAIL_CONFIG.BREVO_BASE_URL, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'accept': 'application/json',
          'api-key': EMAIL_CONFIG.BREVO_API_KEY
        },
        body: JSON.stringify({
          sender: {
            name: input.from?.name || EMAIL_CONFIG.FROM_NAME,
            email: input.from?.email || EMAIL_CONFIG.FROM_ADDRESS
          },
          to: [
            {
              email: input.to.email,
              name: input.to.name
            }
          ],
          subject: input.subject,
          htmlContent: input.html,
          textContent: input.text,
          replyTo: EMAIL_CONFIG.REPLY_TO_ADDRESS
            ? {
              email: EMAIL_CONFIG.REPLY_TO_ADDRESS
            }
            : undefined
        }),
        signal: controller.signal
      });

      const payload = await readJson(response);
      if (!response.ok) {
        throw new EmailProviderError(
          payload?.message || payload?.error || 'Brevo rejected the email request.',
          {
            statusCode: response.status,
            code: payload?.code || 'BREVO_REQUEST_FAILED',
            retryable: isRetryable(response.status)
          }
        );
      }

      return {
        provider: this.name,
        messageId: typeof payload?.messageId === 'string' ? payload.messageId : undefined
      };
    } catch (error) {
      if (error instanceof EmailProviderError) {
        throw error;
      }

      if ((error as Error).name === 'AbortError') {
        throw new EmailProviderError('Brevo request timed out.', {
          code: 'BREVO_TIMEOUT',
          retryable: true
        });
      }

      throw new EmailProviderError((error as Error).message || 'Brevo request failed unexpectedly.', {
        code: 'BREVO_NETWORK_ERROR',
        retryable: true
      });
    } finally {
      clearTimeout(timeout);
    }
  }
}
