import { EmailType, Prisma } from '@prisma/client';

export type EmailDeliveryMode = 'BREVO' | 'RESEND' | 'DEV_PREVIEW' | 'SUPPRESSED';
export type EmailProviderName = 'BREVO' | 'RESEND';

export interface EmailAddress {
  email: string;
  name?: string;
}

export interface TransactionalEmailInput {
  userId: number;
  emailType: EmailType;
  to: EmailAddress;
  subject: string;
  html: string;
  text: string;
  metadata?: Prisma.InputJsonValue;
  isCritical?: boolean;
  debugPreviewCode?: string;
}

export interface EmailProviderSendInput {
  to: EmailAddress;
  subject: string;
  html: string;
  text: string;
}

export interface EmailProviderSendResult {
  provider: EmailProviderName;
  messageId?: string;
}

export interface EmailSendAttempt {
  provider: EmailProviderName;
  ok: boolean;
  statusCode?: number;
  errorCode?: string;
  errorMessage?: string;
}

export interface TransactionalEmailSendResult {
  deliveryMode: EmailDeliveryMode;
  provider: EmailProviderName | null;
  messageId?: string;
  fallbackUsed: boolean;
  attempts: EmailSendAttempt[];
  previewCode?: string;
}

export interface EmailTemplate {
  subject: string;
  html: string;
  text: string;
}

export interface EmailProviderClient {
  readonly name: EmailProviderName;
  isConfigured(): boolean;
  send(input: EmailProviderSendInput): Promise<EmailProviderSendResult>;
}
