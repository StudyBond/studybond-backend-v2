/**
 * ONE-OFF BROADCAST: Premium Discount Flash Sale Announcement
 *
 * Sends the Premium discount announcement to all free, verified, non-banned users.
 * Run with: npx tsx src/scripts/broadcast-premium-discount.ts
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

const BROADCAST_ID = 'premium_discount_flash_sale_2026_06_05';
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
  const checkoutUrl = 'https://studybond.app/dashboard/settings?tab=subscription&utm_source=email&utm_campaign=flash_sale_promo';

  return {
    subject: '⚡ Flash Sale: 20% off StudyBond Premium (24 Hours Only)',
    text: [
      `Hi ${firstName},`,
      '',
      'We are running a quick, limited-time discount for StudyBond Premium — it is now ₦4,000 instead of the standard ₦5,000.',
      '',
      '⚡ This is a 24-hour flash sale. It ends tomorrow, June 6, at 3:00 PM WAT, and will not last forever.',
      '',
      'Here is what StudyBond Premium unlocks for you:',
      '• Unlimited Practice Exams: Unlimited full CBT simulations matching the real UI Post-UTME exam.',
      '• Subject-Specific Practice: Target your preparation on your weak subjects.',
      '• 1v1 Competitive Duels: Challenge other candidates in real-time to build speed and accuracy.',
      '• Advanced Score Analytics: Deep insights into subject score trends.',
      '• Streak Freezers: Protect your daily study habit and progress.',
      '',
      'If you are serious about crushing the exam and securing your admission, this is the perfect time to upgrade.',
      '',
      `Upgrade for ₦4,000 now: ${checkoutUrl}`,
      '',
      'Keep going. UI is closer than it feels.',
      '',
      'Marvellous',
      'Founder, StudyBond',
    ].join('\n'),
    html: `
      <div style="font-family: Georgia, 'Times New Roman', serif; line-height: 1.8; color: #1a1a1a; max-width: 580px; margin: 0 auto; padding: 32px 24px;">
        <p style="font-size: 16px;">Hi ${escapeHtml(firstName)},</p>

        <p style="font-size: 16px;">We are running a quick, limited-time discount for StudyBond Premium — it is now <strong>₦4,000</strong> instead of the standard ₦5,000.</p>

        <p style="font-size: 16px; color: #b91c1c; font-weight: 600;">⚡ This is a 24-hour flash sale. It ends tomorrow, June 6, at 3:00 PM WAT, and will not last forever.</p>

        <p style="font-size: 16px; font-weight: 600; margin-top: 28px;">Here is what StudyBond Premium unlocks for you:</p>
        
        <ul style="font-size: 16px; padding-left: 20px; margin: 12px 0;">
          <li style="margin-bottom: 8px;"><strong>Unlimited Practice Exams</strong>: Unlimited full CBT simulations matching the real UI Post-UTME exam.</li>
          <li style="margin-bottom: 8px;"><strong>Subject-Specific Practice</strong>: Target your preparation on your weak subjects.</li>
          <li style="margin-bottom: 8px;"><strong>1v1 Competitive Duels</strong>: Challenge other candidates in real-time to build speed and accuracy.</li>
          <li style="margin-bottom: 8px;"><strong>Advanced Score Analytics</strong>: Deep insights into subject score trends.</li>
          <li style="margin-bottom: 8px;"><strong>Streak Freezers</strong>: Protect your daily study habit and progress.</li>
        </ul>

        <p style="font-size: 16px; margin-top: 24px;">If you are serious about crushing the exam and securing your admission, this is the perfect time to upgrade.</p>

        <div style="margin: 32px 0; text-align: center;">
          <a href="${escapeHtml(checkoutUrl)}" style="display: inline-block; padding: 14px 32px; background: #e09040; color: #09090b; text-decoration: none; border-radius: 8px; font-weight: 700; font-size: 16px; font-family: Arial, sans-serif; box-shadow: 0 4px 12px rgba(224,144,64,0.25);">Upgrade for ₦4,000</a>
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
  console.log(`\n📧 PREMIUM DISCOUNT FLASH SALE BROADCAST`);
  console.log(`   Mode: ${DRY_RUN ? '🔒 DRY RUN (set DRY_RUN=false to send)' : '🚀 LIVE SEND'}`);
  console.log(`   Broadcast ID: ${BROADCAST_ID}`);
  console.log(`   Batch size: ${BATCH_SIZE}`);
  console.log('');

  // 1. Find all verified, non-banned users who are FREE (not premium) and not unsubscribed
  const freeUsers = await prisma.user.findMany({
    where: {
      isPremium: false,
      isVerified: true,
      isBanned: false,
      emailUnsubscribed: false,
    },
    select: {
      id: true,
      email: true,
      fullName: true,
    },
    orderBy: { id: 'asc' },
  });

  console.log(`   Found ${freeUsers.length} eligible free users`);

  if (freeUsers.length === 0) {
    console.log('   No free users found. Exiting.');
    process.exit(0);
  }

  // 2. Check who already received this broadcast (idempotent re-runs)
  const alreadySent = new Set(
    (await prisma.emailLog.findMany({
      where: {
        emailType: EmailType.SUBSCRIPTION_PROMPT,
        status: 'sent', // ONLY count actual 'sent' emails, NOT 'preview' or 'suppressed' so that local preview runs don't block production runs!
        metadata: {
          path: ['broadcastId'],
          equals: BROADCAST_ID,
        },
      },
      select: { userId: true },
    })).map((row: { userId: number }) => row.userId)
  );

  const toSend = freeUsers.filter((u: { id: number }) => !alreadySent.has(u.id));

  console.log(`   Already sent: ${alreadySent.size}`);
  console.log(`   Remaining: ${toSend.length}`);
  console.log('');

  if (toSend.length === 0) {
    console.log('   ✅ All eligible free users already received this broadcast. Exiting.');
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
          emailType: EmailType.SUBSCRIPTION_PROMPT,
          to: { email: user.email, name: user.fullName },
          subject: email.subject,
          html: email.html,
          text: email.text,
          metadata: {
            broadcastId: BROADCAST_ID,
            campaignKind: 'pricing_promotion',
            promoType: 'flash_sale_discount',
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
  console.log(`   Total free users: ${freeUsers.length}`);

  if (DRY_RUN) {
    console.log('');
    console.log('   ⚠️  This was a DRY RUN. No emails were actually sent.');
    console.log('   To send for real, run: DRY_RUN=false npx tsx src/scripts/broadcast-premium-discount.ts');
  }

  process.exit(0);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
