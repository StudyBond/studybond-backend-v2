/**
 * ONE-OFF BROADCAST: Bookmark Nudge for Low-Bookmark Users
 *
 * Sends a personal, human-toned email to all verified, non-banned users
 * who have fewer than 20 bookmarked questions — encouraging them to take
 * more exams, bookmark the questions they found tricky, study those
 * questions, and then test themselves with Bookmark Exam.
 *
 * NOTE: This intentionally sends to ALL qualifying users regardless of
 *       their emailUnsubscribed status (per product decision).
 *
 * Run with: npx tsx src/scripts/broadcast-bookmark-nudge.ts
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

const BROADCAST_ID = 'bookmark_nudge_low_count_2026_06';
const BATCH_SIZE = 50;
const BATCH_DELAY_MS = 2000;
const MIN_BOOKMARK_THRESHOLD = 20;
const DRY_RUN = process.env.DRY_RUN !== 'false'; // Default: true (safe)

interface UserWithBookmarkCount {
  id: number;
  email: string;
  fullName: string;
  emailUnsubscribed: boolean;
  _count: { bookmarkedQuestions: number };
}

interface EligibleUser {
  id: number;
  email: string;
  fullName: string;
  bookmarkCount: number;
  isUnsubscribed: boolean;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function buildBroadcastEmail(fullName: string, bookmarkCount: number) {
  const firstName = fullName.trim().split(/\s+/)[0] || 'there';

  const bookmarksUrl = 'https://studybond.app/dashboard/bookmarks?utm_source=email&utm_campaign=bookmark_nudge';
  const practiceUrl = 'https://studybond.app/dashboard?utm_source=email&utm_campaign=bookmark_nudge';

  // Personalise the opening line based on whether they have any bookmarks at all
  const hasAny = bookmarkCount > 0;
  const countNote = hasAny
    ? `You've bookmarked ${bookmarkCount} question${bookmarkCount === 1 ? '' : 's'} so far`
    : `You haven't bookmarked any questions yet`;

  return {
    subject: `Quick thought on how you're studying`,
    text: [
      `Hey ${firstName},`,
      '',
      `I noticed something while looking at usage data and wanted to reach out personally.`,
      '',
      `${countNote} — and I think you might be missing out on one of the most effective ways to actually prepare.`,
      '',
      `Here's what I've seen work really well for the students who end up scoring highest:`,
      '',
      `They take an exam. They don't just check their score and move on — they go back through the questions they got wrong or found confusing, and they bookmark those ones. Then later, they come back, study them properly, understand the reasoning behind each answer, and take a short test on just those bookmarked questions.`,
      '',
      `It sounds simple, but it completely changes how well things stick. You're not wasting time on stuff you already know. You're drilling the exact areas where you need the most work.`,
      '',
      `In case you're wondering how to bookmark:`,
      `• During or after an exam, tap the bookmark icon on any question`,
      `• You'll find it right next to the question — just one tap and it's saved`,
      `• All your bookmarked questions show up on your Bookmarks page`,
      '',
      `Once you've got at least 20 saved, you can start a Bookmark Exam — a practice test built entirely from the questions you flagged. It's like having a personal revision sheet that tests you.`,
      '',
      `I'd really recommend trying this approach this week. Take a couple of exams, bookmark the ones that tripped you up, study them, and then test yourself again. You'll feel the difference.`,
      '',
      `Start practising: ${practiceUrl}`,
      `Check your bookmarks: ${bookmarksUrl}`,
      '',
      `You've got this.`,
      '',
      `Marvellous`,
      `StudyBond`,
    ].join('\n'),
    html: `
      <div style="font-family: Georgia, 'Times New Roman', serif; line-height: 1.8; color: #1a1a1a; max-width: 580px; margin: 0 auto; padding: 32px 24px;">
        <p style="font-size: 16px;">Hey ${escapeHtml(firstName)},</p>

        <p style="font-size: 16px;">I noticed something while looking at usage data and wanted to reach out personally.</p>

        <p style="font-size: 16px;">${escapeHtml(countNote)} — and I think you might be missing out on one of the most effective ways to actually prepare.</p>

        <p style="font-size: 16px;">Here's what I've seen work really well for the students who end up scoring highest:</p>

        <p style="font-size: 16px;">They take an exam. They don't just check their score and move on — they go back through the questions they got wrong or found confusing, and they <strong>bookmark</strong> those ones. Then later, they come back, study them properly, understand the reasoning behind each answer, and take a short test on just those bookmarked questions.</p>

        <p style="font-size: 16px;">It sounds simple, but it completely changes how well things stick. You're not wasting time on stuff you already know. You're drilling the exact areas where you need the most work.</p>

        <p style="font-size: 16px; font-weight: 600; margin-top: 24px;">How to bookmark a question:</p>

        <ul style="font-size: 16px; padding-left: 20px; margin: 12px 0;">
          <li style="margin-bottom: 8px;">During or after an exam, tap the <strong>bookmark icon</strong> on any question</li>
          <li style="margin-bottom: 8px;">You'll find it right next to the question — just one tap and it's saved</li>
          <li style="margin-bottom: 8px;">All your bookmarked questions show up on your <strong>Bookmarks</strong> page</li>
        </ul>

        <p style="font-size: 16px;">Once you've got at least 20 saved, you can start a <strong>Bookmark Exam</strong> — a practice test built entirely from the questions you flagged. It's like having a personal revision sheet that tests you.</p>

        <p style="font-size: 16px;">I'd really recommend trying this approach this week. Take a couple of exams, bookmark the ones that tripped you up, study them, and then test yourself again. You'll feel the difference.</p>

        <div style="margin: 28px 0; text-align: center;">
          <a href="${escapeHtml(practiceUrl)}" style="display: inline-block; padding: 14px 28px; background: #1a1a1a; color: #ffffff; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 15px; font-family: Arial, sans-serif;">Start practising</a>
          <span style="display: inline-block; width: 12px;"></span>
          <a href="${escapeHtml(bookmarksUrl)}" style="display: inline-block; padding: 14px 28px; background: #ffffff; color: #1a1a1a; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 15px; font-family: Arial, sans-serif; border: 1.5px solid #d1d5db;">My bookmarks</a>
        </div>

        <p style="font-size: 16px;">You've got this.</p>

        <div style="margin-top: 32px; border-top: 1px solid #e5e7eb; padding-top: 16px;">
          <p style="font-size: 15px; margin: 0;"><strong>Marvellous</strong></p>
          <p style="font-size: 14px; color: #6b7280; margin: 4px 0 0 0;">StudyBond</p>
        </div>
      </div>
    `
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
  console.log(`\n📧 BOOKMARK NUDGE BROADCAST (< ${MIN_BOOKMARK_THRESHOLD} bookmarks)`);
  console.log(`   Mode: ${DRY_RUN ? '🔒 DRY RUN (set DRY_RUN=false to send)' : '🚀 LIVE SEND'}`);
  console.log(`   Broadcast ID: ${BROADCAST_ID}`);
  console.log(`   Batch size: ${BATCH_SIZE}`);
  console.log(`   ⚠️  Sending to ALL qualifying users (including unsubscribed)`);
  console.log('');

  // 1. Find all verified, non-banned users with < 20 bookmarked questions.
  //    Intentionally ignores emailUnsubscribed (per product decision for this broadcast).
  const usersWithCounts = await prisma.user.findMany({
    where: {
      isVerified: true,
      isBanned: false,
    },
    select: {
      id: true,
      email: true,
      fullName: true,
      emailUnsubscribed: true,
      _count: {
        select: {
          bookmarkedQuestions: true,
        },
      },
    },
    orderBy: { id: 'asc' },
  });

  // Filter to users with fewer than the threshold
  const eligibleUsers: EligibleUser[] = usersWithCounts
    .filter((u: UserWithBookmarkCount) => u._count.bookmarkedQuestions < MIN_BOOKMARK_THRESHOLD)
    .map((u: UserWithBookmarkCount) => ({
      id: u.id,
      email: u.email,
      fullName: u.fullName,
      bookmarkCount: u._count.bookmarkedQuestions,
      isUnsubscribed: u.emailUnsubscribed,
    }));

  console.log(`   Total verified non-banned users: ${usersWithCounts.length}`);
  console.log(`   Users with < ${MIN_BOOKMARK_THRESHOLD} bookmarks: ${eligibleUsers.length}`);

  const unsubCount = eligibleUsers.filter((u: EligibleUser) => u.isUnsubscribed).length;
  if (unsubCount > 0) {
    console.log(`   ⚠️  Of those, ${unsubCount} are unsubscribed (will still receive this email)`);
  }

  if (eligibleUsers.length === 0) {
    console.log('   No eligible users found. Exiting.');
    process.exit(0);
  }

  // 2. Check who already received this broadcast (idempotent re-runs)
  const alreadySent = new Set(
    (await prisma.emailLog.findMany({
      where: {
        emailType: EmailType.INACTIVITY_NUDGE,
        status: 'sent',
        metadata: {
          path: ['broadcastId'],
          equals: BROADCAST_ID,
        },
      },
      select: { userId: true },
    })).map((row: { userId: number }) => row.userId)
  );

  const toSend = eligibleUsers.filter((u: EligibleUser) => !alreadySent.has(u.id));

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
      const email = buildBroadcastEmail(user.fullName, user.bookmarkCount);

      if (DRY_RUN) {
        console.log(`     [DRY] Would send to: ${user.email} (${user.fullName}) — ${user.bookmarkCount} bookmarks${user.isUnsubscribed ? ' [UNSUBSCRIBED]' : ''}`);
        sent += 1;
        continue;
      }

      try {
        const result = await transactionalEmailService.send({
          userId: user.id,
          emailType: EmailType.INACTIVITY_NUDGE,
          to: { email: user.email, name: user.fullName },
          subject: email.subject,
          html: email.html,
          text: email.text,
          metadata: {
            broadcastId: BROADCAST_ID,
            campaignKind: 'engagement_nudge',
            feature: 'bookmark_usage',
            bookmarkCount: user.bookmarkCount,
            wasUnsubscribed: user.isUnsubscribed,
          },
        });

        if (result.deliveryMode === 'DEV_PREVIEW') {
          console.log(`     ⚠️  [PREVIEW ONLY - NOT SENT] ${user.email} (API keys missing or local dev mode)`);
        } else if (result.deliveryMode === 'SUPPRESSED') {
          console.log(`     ⚠️  [SUPPRESSED - NOT SENT] ${user.email} (Email system disabled)`);
        } else {
          console.log(`     🚀 [SENT via ${result.deliveryMode}] ${user.email} — ${user.bookmarkCount} bookmarks${user.isUnsubscribed ? ' [was unsubscribed]' : ''}`);
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
  console.log(`   Total eligible users: ${eligibleUsers.length}`);

  if (DRY_RUN) {
    console.log('');
    console.log('   ⚠️  This was a DRY RUN. No emails were actually sent.');
    console.log('   To send for real, run: DRY_RUN=false npx tsx src/scripts/broadcast-bookmark-nudge.ts');
  }

  process.exit(0);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
