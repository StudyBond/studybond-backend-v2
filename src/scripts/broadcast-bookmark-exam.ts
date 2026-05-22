/**
 * ONE-OFF BROADCAST: Bookmark Exam Feature Announcement
 *
 * Sends the Bookmark Exam announcement to all premium, verified, non-banned users.
 * Run with: npx tsx src/scripts/broadcast-bookmark-exam.ts
 *
 * Safety features:
 * - Dry-run mode by default (set DRY_RUN=false to actually send)
 * - Batch processing (50 at a time with 2s delay between batches)
 * - Skips users who already received this broadcast (idempotent)
 * - Full logging of results
 */

import 'dotenv/config';
import { EmailType } from '@prisma/client';
import prisma from '../config/database';
import { transactionalEmailService } from '../shared/email/email.service';

const BROADCAST_ID = 'bookmark_exam_launch_2026_05';
const BATCH_SIZE = 50;
const BATCH_DELAY_MS = 2000;
const DRY_RUN = process.env.DRY_RUN !== 'false'; // Default: true (safe)

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function buildBroadcastEmail(fullName: string) {
  const firstName = fullName.trim().split(/\s+/)[0] || 'there';
  const bookmarksUrl = 'https://studybond.app/dashboard/bookmarks?utm_source=email&utm_campaign=bookmark_exam_launch';

  return {
    subject: 'We built this one specifically for you',
    text: [
      `Hi ${firstName},`,
      '',
      'Something quiet has been happening every time you practice on StudyBond.',
      '',
      'Every question you bookmarked — the tricky ones, the ones that caught you off guard, the ones you flagged and told yourself "I need to come back to this" — we\'ve been holding onto all of them.',
      '',
      'Today, they become your exam.',
      '',
      'We just shipped Bookmark Exam — a new feature that turns every question you\'ve ever saved into a focused, personalised practice session. No random questions. No subjects you\'ve already mastered. Just the ones you chose. The ones that matter most to your preparation.',
      '',
      'Here\'s how it works:',
      '',
      'Head to your Bookmarks page, and if you\'ve saved at least 20 questions, you\'ll see a new option waiting for you — "Start Bookmark Exam." Hit it, and we\'ll build your session on the spot. You can filter by subject if you want to drill a specific area, or go all in with everything you\'ve collected.',
      '',
      'The result? An exam that\'s uniquely yours. Built by your study habits. Targeted at your actual weak spots.',
      '',
      'This is one of those features that sounds simple until you sit down with it — and then it clicks.',
      '',
      `Go try it: ${bookmarksUrl}`,
      '',
      'Keep going. UI is closer than it feels.',
      '',
      'Dr Sponsor',
      'Founder, StudyBond',
    ].join('\n'),
    html: `
      <div style="font-family: Georgia, 'Times New Roman', serif; line-height: 1.8; color: #1a1a1a; max-width: 580px; margin: 0 auto; padding: 32px 24px;">
        <p style="font-size: 16px;">Hi ${escapeHtml(firstName)},</p>

        <p style="font-size: 16px;">Something quiet has been happening every time you practice on StudyBond.</p>

        <p style="font-size: 16px;">Every question you bookmarked — the tricky ones, the ones that caught you off guard, the ones you flagged and told yourself <em>"I need to come back to this"</em> — we've been holding onto all of them.</p>

        <p style="font-size: 16px;"><strong>Today, they become your exam.</strong></p>

        <p style="font-size: 16px;">We just shipped <strong>Bookmark Exam</strong> — a new feature that turns every question you've ever saved into a focused, personalised practice session. No random questions. No subjects you've already mastered. Just the ones you chose. The ones that matter most to your preparation.</p>

        <p style="font-size: 16px; font-weight: 600; margin-top: 28px;">Here's how it works:</p>

        <p style="font-size: 16px;">Head to your Bookmarks page, and if you've saved at least 20 questions, you'll see a new option waiting for you — <strong>"Start Bookmark Exam."</strong> Hit it, and we'll build your session on the spot. You can filter by subject if you want to drill a specific area, or go all in with everything you've collected.</p>

        <p style="font-size: 16px;">The result? An exam that's uniquely yours. Built by your study habits. Targeted at your actual weak spots.</p>

        <p style="font-size: 16px; color: #4b5563;">This is one of those features that sounds simple until you sit down with it — and then it clicks.</p>

        <div style="margin: 28px 0; text-align: center;">
          <a href="${escapeHtml(bookmarksUrl)}" style="display: inline-block; padding: 14px 32px; background: #4f46e5; color: #ffffff; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 16px; font-family: Arial, sans-serif;">Go try it</a>
        </div>

        <p style="font-size: 16px;">Keep going. UI is closer than it feels.</p>

        <div style="margin-top: 32px; border-top: 1px solid #e5e7eb; padding-top: 16px;">
          <p style="font-size: 15px; margin: 0;"><strong>Marvellous</strong></p>
          <p style="font-size: 14px; color: #6b7280; margin: 4px 0 0 0;">Founder, StudyBond</p>
        </div>
      </div>
    `
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
  console.log(`\n📧 BOOKMARK EXAM BROADCAST`);
  console.log(`   Mode: ${DRY_RUN ? '🔒 DRY RUN (set DRY_RUN=false to send)' : '🚀 LIVE SEND'}`);
  console.log(`   Broadcast ID: ${BROADCAST_ID}`);
  console.log(`   Batch size: ${BATCH_SIZE}`);
  console.log('');

  // 1. Find all premium, verified, non-banned users
  const premiumUsers = await prisma.user.findMany({
    where: {
      isPremium: true,
      isVerified: true,
      isBanned: false,
    },
    select: {
      id: true,
      email: true,
      fullName: true,
    },
    orderBy: { id: 'asc' },
  });

  console.log(`   Found ${premiumUsers.length} premium users`);

  if (premiumUsers.length === 0) {
    console.log('   No premium users found. Exiting.');
    process.exit(0);
  }

  // 2. Check who already received this broadcast (idempotent re-runs)
  const alreadySent = new Set(
    (await prisma.emailLog.findMany({
      where: {
        emailType: EmailType.WELCOME_EMAIL,
        status: { in: ['sent', 'preview'] },
        metadata: {
          path: ['broadcastId'],
          equals: BROADCAST_ID,
        },
      },
      select: { userId: true },
    })).map((row: { userId: number }) => row.userId)
  );

  const toSend = premiumUsers.filter((u: { id: number }) => !alreadySent.has(u.id));

  console.log(`   Already sent: ${alreadySent.size}`);
  console.log(`   Remaining: ${toSend.length}`);
  console.log('');

  if (toSend.length === 0) {
    console.log('   ✅ All premium users already received this broadcast. Exiting.');
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
      const email = buildBroadcastEmail(user.fullName);

      if (DRY_RUN) {
        console.log(`     [DRY] Would send to: ${user.email} (${user.fullName})`);
        sent += 1;
        continue;
      }

      try {
        await transactionalEmailService.send({
          userId: user.id,
          emailType: EmailType.WELCOME_EMAIL,
          to: { email: user.email, name: user.fullName },
          subject: email.subject,
          html: email.html,
          text: email.text,
          metadata: {
            broadcastId: BROADCAST_ID,
            campaignKind: 'product_announcement',
            feature: 'bookmark_exam',
          },
        });

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
  console.log(`   Total premium users: ${premiumUsers.length}`);

  if (DRY_RUN) {
    console.log('');
    console.log('   ⚠️  This was a DRY RUN. No emails were actually sent.');
    console.log('   To send for real, run: DRY_RUN=false npx tsx src/scripts/broadcast-bookmark-exam.ts');
  }

  process.exit(0);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
