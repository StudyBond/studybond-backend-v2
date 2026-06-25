/**
 * ONE-OFF BROADCAST: Medicine / MBBS Outreach Campaign (78.875. Where are you right now?)
 *
 * Sends the outreach email to all verified, non-banned users whose aspiringCourse
 * matches MBBS, Medicine, or related variations.
 *
 * Run with: npx tsx src/scripts/broadcast-medicine-outreach.ts
 *
 * Safety features:
 * - Dry-run mode by default (pass --send or set DRY_RUN=false to send)
 * - Batch processing (50 at a time with 2s delay between batches)
 * - Skips users who already received this broadcast (idempotent)
 * - Full logging of results
 */

import 'dotenv/config';
import { EmailType } from '@prisma/client';
import prisma from '../config/database';
import { transactionalEmailService } from '../shared/email/email.service';

const BROADCAST_ID = 'ui_medicine_outreach_2026_06_25';
const BATCH_SIZE = 50;
const BATCH_DELAY_MS = 2000;

const TARGET_COURSES = new Set([
  'mbbs',
  'mb;bs',
  'medicine',
  'medicine & surgery',
  'med',
  'medicine and surgery',
  'mmbs'
]);

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function firstName(fullName: string): string {
  return fullName.trim().split(/\s+/)[0] || 'there';
}

function parseArgs(argv: string[]) {
  const args: Record<string, string | boolean> = {};

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

function buildOutreachEmail(fullName: string) {
  const name = firstName(fullName);
  const appUrl = 'https://studybond.app';

  const text = [
    `Hey ${name},`,
    '',
    `UI's MBBS departmental cutoff last year was 78.875. That's not a target — that's the floor candidates cleared just to be considered.`,
    '',
    `With less than 5 weeks left, here's where you should honestly be right now: consistently hitting 80-85+ on your StudyBond mocks, using the real past questions. If you're below that consistently at this stage, that's not a reason to panic — it's useful information. It tells you exactly where the gap is while there's still time to close it.`,
    '',
    `But 80-85 isn't actually the target. Cutoffs don't sit still, and you don't want to be the candidate who scraped past last year's number only to miss this year's. The real number to chase is 90+, consistently — not on a lucky day.`,
    '',
    `One thing that actually moves people from "scoring okay" to "scoring 90+": after every mock, go back through every question — the ones you got wrong AND the ones you guessed right — and understand exactly why the answer is what it is. Most people only review what they missed. The ones who pull ahead review everything.`,
    '',
    `Five weeks is enough time to close a real gap if you use it deliberately. Open today's mock at studybond.app and see exactly where you stand against that 90+ number.`,
    '',
    `— Marvellous`,
    '',
    '---',
    'You are receiving this because you signed up for StudyBond.',
    `Unsubscribe from marketing emails: ${appUrl}/settings/notifications?unsubscribe=marketing`
  ].join('\n');

  const html = `
    <div style="font-family: Georgia, 'Times New Roman', serif; line-height: 1.8; color: #1a1a1a; max-width: 580px; margin: 0 auto; padding: 24px 16px;">
      <p style="font-size: 16px;">Hey ${escapeHtml(name)},</p>
      
      <p style="font-size: 16px;">
        UI's MBBS departmental cutoff last year was 78.875. That's not a target — that's the floor candidates cleared just to be considered.
      </p>
      
      <p style="font-size: 16px;">
        With less than 5 weeks left, here's where you should honestly be right now: consistently hitting 80-85+ on your StudyBond mocks, using the real past questions. If you're below that consistently at this stage, that's not a reason to panic — it's useful information. It tells you exactly where the gap is while there's still time to close it.
      </p>
      
      <p style="font-size: 16px;">
        But 80-85 isn't actually the target. Cutoffs don't sit still, and you don't want to be the candidate who scraped past last year's number only to miss this year's. The real number to chase is 90+, consistently — not on a lucky day.
      </p>
      
      <p style="font-size: 16px;">
        One thing that actually moves people from "scoring okay" to "scoring 90+": after every mock, go back through every question — the ones you got wrong AND the ones you guessed right — and understand exactly why the answer is what it is. Most people only review what they missed. The ones who pull ahead review everything.
      </p>
      
      <p style="font-size: 16px;">
        Five weeks is enough time to close a real gap if you use it deliberately. Open today's mock at <a href="${appUrl}" style="color: #e09040; text-decoration: underline;">studybond.app</a> and see exactly where you stand against that 90+ number.
      </p>
      
      <p style="font-size: 16px; margin-bottom: 24px;">— Marvellous</p>
      
      <div style="margin-top: 40px; border-top: 1px solid #e5e7eb; padding-top: 16px; font-size: 12px; color: #9ca3af; font-family: Arial, sans-serif; line-height: 1.4;">
        You are receiving this because you signed up for StudyBond.<br/>
        <a href="${appUrl}/settings/notifications?unsubscribe=marketing" style="color: #6b7280; text-decoration: underline;">Unsubscribe from marketing emails</a>
      </div>
    </div>
  `;

  return {
    subject: '78.875. Where are you right now?',
    text,
    html,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const dryRun = args.send !== true && process.env.DRY_RUN !== 'false';
  const emailFilter = args.email ? String(args.email).trim().toLowerCase() : null;

  console.log(`\n📧 MEDICINE / MBBS OUTREACH BROADCAST`);
  console.log(`   Mode: ${dryRun ? '🔒 DRY RUN (pass --send or set DRY_RUN=false to send)' : '🚀 LIVE SEND'}`);
  console.log(`   Broadcast ID: ${BROADCAST_ID}`);
  console.log(`   Batch size: ${BATCH_SIZE}`);
  if (emailFilter) {
    console.log(`   Filter by email: ${emailFilter}`);
  }
  console.log('');

  // 1. Fetch users. If email filter is specified, load just that email.
  // Otherwise, load all verified, non-banned, opted-in users who have an aspiring course.
  const whereClause: any = emailFilter
    ? { email: emailFilter }
    : {
        isVerified: true,
        isBanned: false,
        emailUnsubscribed: false,
        aspiringCourse: {
          not: null,
        },
      };

  const dbUsers = await prisma.user.findMany({
    where: whereClause,
    select: {
      id: true,
      email: true,
      fullName: true,
      aspiringCourse: true,
    },
    orderBy: { id: 'asc' },
  });

  // Filter in memory for Medicine/MBBS related courses (unless we are targeted to a specific test email)
  const users = emailFilter
    ? dbUsers
    : dbUsers.filter((user: { aspiringCourse: string; }) => {
        if (!user.aspiringCourse) return false;
        const course = user.aspiringCourse.trim().toLowerCase();
        return TARGET_COURSES.has(course);
      });

  console.log(`   Found ${users.length} eligible users`);

  if (users.length === 0) {
    console.log('   No eligible users found. Exiting.');
    process.exit(0);
  }

  // 2. Check who already received this broadcast (skipped if email filter is active)
  const alreadySent = emailFilter
    ? new Set<number>()
    : new Set(
        (await prisma.emailLog.findMany({
          where: {
            emailType: EmailType.SUBSCRIPTION_PROMPT,
            status: 'sent',
            metadata: {
              path: ['broadcastId'],
              equals: BROADCAST_ID,
            },
          },
          select: { userId: true },
        })).map((row: { userId: number }) => row.userId)
      );

  const toSend = users.filter((u: { id: number }) => !alreadySent.has(u.id));

  console.log(`   Already sent: ${alreadySent.size}`);
  console.log(`   Remaining: ${toSend.length}`);
  console.log('');

  if (toSend.length === 0) {
    console.log('   ✅ All eligible users already received this broadcast. Exiting.');
    process.exit(0);
  }

  // 3. Send in batches
  let sent = 0;
  let failed = 0;

  for (let i = 0; i < toSend.length; i += BATCH_SIZE) {
    const batch = toSend.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(toSend.length / BATCH_SIZE);

    console.log(`   Batch ${batchNum}/${totalBatches} (${batch.length} users)...`);

    for (const user of batch) {
      const email = buildOutreachEmail(user.fullName);

      if (dryRun) {
        console.log(`     [DRY] Would send to: ${user.email} (${user.fullName} - ${user.aspiringCourse})`);
        sent += 1;
        continue;
      }

      try {
        const result = await transactionalEmailService.send({
          userId: user.id,
          emailType: EmailType.SUBSCRIPTION_PROMPT,
          to: { email: user.email, name: user.fullName },
          from: { email: 'hello@mail.studybond.app', name: 'Marvellous' },
          subject: email.subject,
          html: email.html,
          text: email.text,
          metadata: {
            broadcastId: BROADCAST_ID,
            campaignKind: 'outreach',
            promoType: 'medicine_special',
          },
        });

        if (result.deliveryMode === 'DEV_PREVIEW') {
          console.log(`     ⚠️  [PREVIEW ONLY - NOT SENT] ${user.email} (API keys missing or local environment dev mode)`);
        } else if (result.deliveryMode === 'SUPPRESSED') {
          console.log(`     ⚠️  [SUPPRESSED - NOT SENT] ${user.email} (Email system disabled in settings)`);
        } else {
          console.log(`     🚀 [SENT via ${result.deliveryMode}] ${user.email}`);
        }

        sent += 1;
      } catch (err) {
        failed += 1;
        console.error(`     ❌ Failed: ${user.email} — ${err instanceof Error ? err.message : 'Unknown error'}`);
      }
    }

    // Delay between batches to avoid rate limits
    if (i + BATCH_SIZE < toSend.length) {
      await sleep(BATCH_DELAY_MS);
    }
  }

  console.log('');
  console.log(`   ✅ Done!`);
  console.log(`   Sent: ${sent}`);
  console.log(`   Failed: ${failed}`);
  console.log(`   Total users: ${users.length}`);

  if (dryRun) {
    console.log('');
    console.log('   ⚠️  This was a DRY RUN. No emails were actually sent.');
    console.log('   To send for real, pass the --send flag or run with DRY_RUN=false.');
  }

  process.exit(0);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
