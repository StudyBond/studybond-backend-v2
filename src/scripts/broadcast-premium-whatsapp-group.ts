/**
 * ONE-OFF BROADCAST: Premium WhatsApp Brainstorming Group Invite
 *
 * Sends a personal invite to all active premium users to join
 * the private WhatsApp brainstorming group.
 *
 * Run with: npx tsx src/scripts/broadcast-premium-whatsapp-group.ts
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

const BROADCAST_ID = 'premium_whatsapp_brainstorm_group_2026_06';
const BATCH_SIZE = 50;
const BATCH_DELAY_MS = 2000;
const DRY_RUN = process.env.DRY_RUN !== 'false'; // Default: true (safe)

const WHATSAPP_GROUP_URL = 'https://chat.whatsapp.com/HGHGmxBYOtzDwzOyrb6GVx?s=sh&p=a&ilr=1';
const FROM_ADDRESS = 'hello@mail.studybond.app';
const FROM_NAME = 'Marvellous from StudyBond';

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

  return {
    subject: 'Quick one for you',
    text: [
      `Hi ${firstName},`,
      '',
      'I wanted to reach out to you directly.',
      '',
      'We just set up a small WhatsApp group strictly for premium members — a space where you can brainstorm with other serious students, share what is working, ask questions, and connect with people who are actually putting in the work.',
      '',
      'It is not a broadcast channel. It is a real conversation space, and it is only for premium users like you.',
      '',
      `Here is the link to join: ${WHATSAPP_GROUP_URL}`,
      '',
      'If you have any ideas on what you would like us to discuss first, just drop it in the group once you join.',
      '',
      'Talk soon,',
      'Marvellous',
    ].join('\n'),
    html: `
      <div style="font-family: Arial, sans-serif; line-height: 1.7; color: #1a1a1a; max-width: 580px; margin: 0 auto; padding: 24px;">
        <p style="font-size: 15px; margin: 0 0 16px;">Hi ${escapeHtml(firstName)},</p>

        <p style="font-size: 15px; margin: 0 0 16px;">I wanted to reach out to you directly.</p>

        <p style="font-size: 15px; margin: 0 0 16px;">We just set up a small WhatsApp group strictly for premium members — a space where you can brainstorm with other serious students, share what is working, ask questions, and connect with people who are actually putting in the work.</p>

        <p style="font-size: 15px; margin: 0 0 16px;">It is not a broadcast channel. It is a real conversation space, and it is only for premium users like you.</p>

        <p style="font-size: 15px; margin: 0 0 16px;">Here is the link to join: <a href="${escapeHtml(WHATSAPP_GROUP_URL)}" style="color: #1a73e8; text-decoration: underline;">Join the group</a></p>

        <p style="font-size: 15px; margin: 0 0 16px;">If you have any ideas on what you would like us to discuss first, just drop it in the group once you join.</p>

        <p style="font-size: 15px; margin: 24px 0 0;">Talk soon,<br/>Marvellous</p>
      </div>
    `
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
  console.log(`\n📧 PREMIUM WHATSAPP GROUP BROADCAST`);
  console.log(`   Mode: ${DRY_RUN ? '🔒 DRY RUN (set DRY_RUN=false to send)' : '🚀 LIVE SEND'}`);
  console.log(`   Broadcast ID: ${BROADCAST_ID}`);
  console.log(`   Batch size: ${BATCH_SIZE}`);
  console.log(`   From: ${FROM_NAME} <${FROM_ADDRESS}>`);
  console.log('');

  // 1. Find all verified, non-banned premium users
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

  console.log(`   Found ${premiumUsers.length} eligible premium users`);

  if (premiumUsers.length === 0) {
    console.log('   No premium users found. Exiting.');
    process.exit(0);
  }

  // 2. Check who already received this broadcast (idempotent re-runs)
  const alreadySent = new Set(
    (await prisma.emailLog.findMany({
      where: {
        emailType: EmailType.SERVICE_NOTICE,
        status: 'sent',
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
    console.log('   ✅ All eligible premium users already received this broadcast. Exiting.');
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
        const result = await transactionalEmailService.send({
          userId: user.id,
          emailType: EmailType.SERVICE_NOTICE,
          to: { email: user.email, name: user.fullName },
          from: { email: FROM_ADDRESS, name: FROM_NAME },
          subject: email.subject,
          html: email.html,
          text: email.text,
          metadata: {
            broadcastId: BROADCAST_ID,
            campaignKind: 'premium_whatsapp_group',
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
  console.log(`   Total premium users: ${premiumUsers.length}`);

  if (DRY_RUN) {
    console.log('');
    console.log('   ⚠️  This was a DRY RUN. No emails were actually sent.');
    console.log('   To send for real, run: DRY_RUN=false npx tsx src/scripts/broadcast-premium-whatsapp-group.ts');
  }

  process.exit(0);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
