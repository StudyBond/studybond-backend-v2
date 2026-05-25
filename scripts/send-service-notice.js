#!/usr/bin/env node

require('dotenv').config({ quiet: true });

const { Pool } = require('pg');
const { PrismaPg } = require('@prisma/adapter-pg');
const { PrismaClient, EmailProvider, EmailType } = require('@prisma/client');

const BROADCAST_ID = 'redis_rate_limiter_incident_resolved_2026_05_25';
const DEFAULT_BATCH_SIZE = 40;
const DEFAULT_DELAY_MS = 1500;
const DEFAULT_APP_URL = process.env.APP_BASE_URL || process.env.WEB_APP_URL || 'https://studybond.app';

function parseArgs(argv) {
  const args = {};

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) continue;

    const trimmed = token.slice(2);
    const eqIndex = trimmed.indexOf('=');
    if (eqIndex >= 0) {
      args[trimmed.slice(0, eqIndex)] = trimmed.slice(eqIndex + 1) || true;
      continue;
    }

    const next = argv[index + 1];
    if (!next || next.startsWith('--')) {
      args[trimmed] = true;
      continue;
    }

    args[trimmed] = next;
    index += 1;
  }

  return args;
}

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(String(value || ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function resolveConnectionString() {
  return process.env.DIRECT_URL || process.env.DATABASE_URL || null;
}

function buildPrisma() {
  const connectionString = resolveConnectionString();
  if (!connectionString) {
    throw new Error('Missing DIRECT_URL or DATABASE_URL.');
  }

  const pool = new Pool({ connectionString });
  const adapter = new PrismaPg(pool);
  const prisma = new PrismaClient({ adapter });

  return { prisma, pool };
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function firstName(fullName) {
  return String(fullName || '').trim().split(/\s+/)[0] || 'there';
}

function buildServiceNoticeEmail(user, appUrl) {
  const dashboardUrl = `${appUrl.replace(/\/$/, '')}/dashboard?utm_source=email&utm_campaign=service_notice`;
  const name = firstName(user.fullName);

  const text = [
    `Hi ${name},`,
    '',
    'Earlier today, some users were unable to access parts of StudyBond, including taking exams, viewing exam history, and using some dashboard features.',
    '',
    'We have identified and fixed the issue. You can now continue using StudyBond normally, including starting and submitting exams.',
    '',
    'Your existing account, progress, and exam records remain safe.',
    '',
    'We are sorry for the disruption this caused, especially if you were in the middle of studying or preparing for an exam. Thank you for your patience while we resolved it.',
    '',
    `Continue studying: ${dashboardUrl}`,
    '',
    'Best,',
    'The StudyBond Team',
  ].join('\n');

  const html = `
    <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #111827; max-width: 600px; margin: 0 auto; padding: 28px 24px;">
      <h2 style="margin: 0 0 18px; font-size: 22px;">StudyBond access issue resolved</h2>
      <p>Hi ${escapeHtml(name)},</p>
      <p>Earlier today, some users were unable to access parts of StudyBond, including taking exams, viewing exam history, and using some dashboard features.</p>
      <p><strong>We have identified and fixed the issue.</strong> You can now continue using StudyBond normally, including starting and submitting exams.</p>
      <p>Your existing account, progress, and exam records remain safe.</p>
      <p>We are sorry for the disruption this caused, especially if you were in the middle of studying or preparing for an exam. Thank you for your patience while we resolved it.</p>
      <div style="margin: 26px 0; text-align: center;">
        <a href="${escapeHtml(dashboardUrl)}" style="display: inline-block; padding: 13px 28px; background: #10b981; color: #ffffff; text-decoration: none; border-radius: 8px; font-weight: 700;">Continue studying</a>
      </div>
      <p style="margin-top: 28px;">Best,<br/>The StudyBond Team</p>
    </div>
  `;

  return {
    subject: 'StudyBond is back online: exam access issue resolved',
    text,
    html,
  };
}

function getEmailConfig() {
  return {
    fromName: (process.env.EMAIL_FROM_NAME || 'StudyBond').trim(),
    fromAddress: (process.env.EMAIL_FROM_ADDRESS || '').trim(),
    replyToAddress: (process.env.EMAIL_REPLY_TO_ADDRESS || '').trim() || undefined,
    providerTimeoutMs: parsePositiveInt(process.env.EMAIL_PROVIDER_TIMEOUT_MS, 10000),
    brevoApiKey: (process.env.BREVO_API_KEY || '').trim(),
    brevoBaseUrl: (process.env.BREVO_BASE_URL || 'https://api.brevo.com/v3/smtp/email').trim(),
    resendApiKey: (process.env.RESEND_API_KEY || '').trim(),
    resendBaseUrl: (process.env.RESEND_BASE_URL || 'https://api.resend.com/emails').trim(),
  };
}

async function readJson(response) {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { message: text };
  }
}

function isRetryable(statusCode) {
  if (statusCode === undefined) return true;
  if (statusCode === 400 || statusCode === 422) return false;
  return true;
}

async function sendWithBrevo(config, input) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.providerTimeoutMs);

  try {
    const response = await fetch(config.brevoBaseUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
        'api-key': config.brevoApiKey,
      },
      body: JSON.stringify({
        sender: { name: config.fromName, email: config.fromAddress },
        to: [{ email: input.to.email, name: input.to.name }],
        subject: input.subject,
        htmlContent: input.html,
        textContent: input.text,
        replyTo: config.replyToAddress ? { email: config.replyToAddress } : undefined,
      }),
      signal: controller.signal,
    });

    const payload = await readJson(response);
    if (!response.ok) {
      const error = new Error(payload?.message || payload?.error || 'Brevo rejected the email request.');
      error.statusCode = response.status;
      error.code = payload?.code || 'BREVO_REQUEST_FAILED';
      error.retryable = isRetryable(response.status);
      throw error;
    }

    return { provider: 'BREVO', messageId: typeof payload?.messageId === 'string' ? payload.messageId : undefined };
  } finally {
    clearTimeout(timeout);
  }
}

async function sendWithResend(config, input) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.providerTimeoutMs);

  try {
    const response = await fetch(config.resendBaseUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
        authorization: `Bearer ${config.resendApiKey}`,
      },
      body: JSON.stringify({
        from: `${config.fromName} <${config.fromAddress}>`,
        to: [input.to.email],
        reply_to: config.replyToAddress,
        subject: input.subject,
        html: input.html,
        text: input.text,
      }),
      signal: controller.signal,
    });

    const payload = await readJson(response);
    if (!response.ok) {
      const details = payload?.error || payload?.message || payload?.name;
      const error = new Error(typeof details === 'string' ? details : 'Resend rejected the email request.');
      error.statusCode = response.status;
      error.code = payload?.name || payload?.code || 'RESEND_REQUEST_FAILED';
      error.retryable = isRetryable(response.status);
      throw error;
    }

    return { provider: 'RESEND', messageId: typeof payload?.id === 'string' ? payload.id : undefined };
  } finally {
    clearTimeout(timeout);
  }
}

async function writeEmailLog(prisma, user, email, entry) {
  await prisma.emailLog.create({
    data: {
      userId: user.id,
      emailType: EmailType.SERVICE_NOTICE,
      provider: entry.provider ? EmailProvider[entry.provider] : null,
      recipientEmail: user.email,
      subject: email.subject,
      status: entry.status,
      emailServiceId: entry.messageId,
      errorMessage: entry.errorMessage,
      metadata: {
        broadcastId: BROADCAST_ID,
        noticeKind: 'incident_resolved',
        incident: 'redis_rate_limiter_closed_connection',
        fallbackUsed: Boolean(entry.fallbackUsed),
        attemptCount: entry.attemptCount || 0,
      },
    },
  });
}

async function sendEmail(prisma, config, user, email) {
  const providers = [];
  if (config.brevoApiKey && config.fromAddress) providers.push({ name: 'BREVO', send: sendWithBrevo });
  if (config.resendApiKey && config.fromAddress) providers.push({ name: 'RESEND', send: sendWithResend });

  if (providers.length === 0) {
    throw new Error('No email provider configured. Set EMAIL_FROM_ADDRESS plus BREVO_API_KEY or RESEND_API_KEY.');
  }

  const attempts = [];
  for (let index = 0; index < providers.length; index += 1) {
    const provider = providers[index];

    try {
      const result = await provider.send(config, {
        to: { email: user.email, name: user.fullName },
        subject: email.subject,
        html: email.html,
        text: email.text,
      });

      await writeEmailLog(prisma, user, email, {
        provider: result.provider,
        status: 'sent',
        messageId: result.messageId,
        fallbackUsed: attempts.some((attempt) => !attempt.ok),
        attemptCount: attempts.length + 1,
      });

      return;
    } catch (error) {
      attempts.push({
        provider: provider.name,
        ok: false,
        retryable: error.retryable !== false,
        message: error.message,
      });

      await writeEmailLog(prisma, user, email, {
        provider: provider.name,
        status: 'failed',
        errorMessage: error.message,
        attemptCount: attempts.length,
      });

      const isLastProvider = index === providers.length - 1;
      if (isLastProvider || error.retryable === false) {
        throw error;
      }
    }
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const dryRun = args.send !== true && process.env.DRY_RUN !== 'false';
  const batchSize = parsePositiveInt(args['batch-size'] || process.env.BATCH_SIZE, DEFAULT_BATCH_SIZE);
  const delayMs = parsePositiveInt(args['delay-ms'] || process.env.BATCH_DELAY_MS, DEFAULT_DELAY_MS);
  const limit = args.limit ? parsePositiveInt(args.limit, 0) : undefined;
  const emailFilter = args.email ? String(args.email).trim().toLowerCase() : null;
  const includeOptedOut = args['include-opted-out'] === true;
  const appUrl = String(args['app-url'] || DEFAULT_APP_URL);

  const { prisma, pool } = buildPrisma();

  try {
    console.log('');
    console.log('StudyBond service notice broadcast');
    console.log(`Mode: ${dryRun ? 'DRY RUN' : 'LIVE SEND'}`);
    console.log(`Broadcast ID: ${BROADCAST_ID}`);
    console.log(`Batch size: ${batchSize}`);
    console.log(`Delay: ${delayMs}ms`);
    console.log(`Email filter: ${emailFilter || 'none'}`);
    console.log(`Include opted out: ${includeOptedOut ? 'yes' : 'no'}`);
    console.log('');

    if (!dryRun) {
      const settings = await prisma.systemSettings.findUnique({
        where: { id: 1 },
        select: { emailEnabled: true },
      });

      if (settings && !settings.emailEnabled && args['ignore-email-toggle'] !== true) {
        throw new Error('Email system is disabled. Re-enable it or pass --ignore-email-toggle.');
      }
    }

    const alreadySentRows = await prisma.emailLog.findMany({
      where: {
        emailType: EmailType.SERVICE_NOTICE,
        status: { in: ['sent', 'preview'] },
        metadata: {
          path: ['broadcastId'],
          equals: BROADCAST_ID,
        },
      },
      select: { userId: true },
    });

    const alreadySent = new Set(alreadySentRows.map((row) => row.userId));

    const users = await prisma.user.findMany({
      where: {
        isVerified: true,
        isBanned: false,
        ...(emailFilter ? { email: emailFilter } : {}),
        ...(includeOptedOut ? {} : { emailUnsubscribed: false }),
      },
      select: {
        id: true,
        email: true,
        fullName: true,
        emailUnsubscribed: true,
      },
      orderBy: { id: 'asc' },
      ...(limit ? { take: limit } : {}),
    });

    const recipients = users.filter((user) => !alreadySent.has(user.id));

    console.log(`Eligible users found: ${users.length}`);
    console.log(`Already sent: ${alreadySent.size}`);
    console.log(`Remaining recipients: ${recipients.length}`);
    console.log('');

    if (recipients.length === 0) {
      console.log('Nothing to send.');
      return;
    }

    const config = getEmailConfig();
    let sent = 0;
    let failed = 0;

    for (let index = 0; index < recipients.length; index += batchSize) {
      const batch = recipients.slice(index, index + batchSize);
      const batchNumber = Math.floor(index / batchSize) + 1;
      const totalBatches = Math.ceil(recipients.length / batchSize);
      console.log(`Batch ${batchNumber}/${totalBatches} (${batch.length} users)`);

      for (const user of batch) {
        const email = buildServiceNoticeEmail(user, appUrl);

        if (dryRun) {
          console.log(`  [DRY] ${user.email} (${user.fullName})`);
          sent += 1;
          continue;
        }

        try {
          await sendEmail(prisma, config, user, email);
          console.log(`  [SENT] ${user.email}`);
          sent += 1;
        } catch (error) {
          console.error(`  [FAILED] ${user.email}: ${error.message}`);
          failed += 1;
        }
      }

      if (index + batchSize < recipients.length) {
        await sleep(delayMs);
      }
    }

    console.log('');
    console.log('Done.');
    console.log(`Sent/previewed: ${sent}`);
    console.log(`Failed: ${failed}`);

    if (dryRun) {
      console.log('');
      console.log('This was a dry run. To send for real:');
      console.log('  npm run send:service-notice -- --send');
    }
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

main().catch((error) => {
  console.error('');
  console.error('Fatal error:', error);
  process.exit(1);
});
