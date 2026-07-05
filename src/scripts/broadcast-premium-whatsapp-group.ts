/**
 * ONE-OFF BROADCAST: Premium WhatsApp Group Invite (v2 — resend with corrected content)
 *
 * Sends a personal invite to all active premium users to join
 * the private WhatsApp group for brainstorming and 1v1 Duel pairing.
 *
 * Run with: npx tsx src/scripts/broadcast-premium-whatsapp-group.ts
 *
 * Safety features:
 * - Dry-run mode by default (set DRY_RUN=false to actually send)
 * - Batch processing (50 at a time with 2s delay between batches)
 * - Skips users who already received this broadcast (idempotent)
 * - Full logging of results
 */

import "dotenv/config";
import { EmailProvider, EmailType } from "@prisma/client";
import prisma from "../config/database";
import { EmailProviderError } from "../shared/email/email-provider-error";
import { BrevoEmailProvider } from "../shared/email/providers/brevo.provider";

// ✅ New BROADCAST_ID so this resend goes to everyone, including users who
// received the old version (which landed in Promotions and was likely unseen)
const BROADCAST_ID = "premium_whatsapp_group_invite_v2_2026_07";
const BATCH_SIZE = 50;
const BATCH_DELAY_MS = 2000;

const WHATSAPP_GROUP_URL =
  "https://chat.whatsapp.com/HGHGmxBYOtzDwzOyrb6GVx?s=sh&p=a&ilr=1";
const FROM_ADDRESS = "hello@mail.studybond.app";
const FROM_NAME = "Marvellous"; // ✅ No brand name in sender — avoids Promotions trigger
const brevoProvider = new BrevoEmailProvider();

function parseArgs(argv: string[]) {
  const args: Record<string, string | boolean> = {};

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) continue;

    const trimmed = token.slice(2);
    const eqIndex = trimmed.indexOf("=");
    if (eqIndex >= 0) {
      args[trimmed.slice(0, eqIndex)] = trimmed.slice(eqIndex + 1) || true;
      continue;
    }

    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      args[trimmed] = true;
      continue;
    }

    args[trimmed] = next;
    index += 1;
  }

  return args;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function buildBroadcastEmail(fullName: string) {
  const firstName = fullName.trim().split(/\s+/)[0] || "there";

  const text = [
    `Hey ${firstName},`,
    "",
    "Since you're on the paid plan, I want to personally invite you to a WhatsApp group we just set up for paid subscribers.",
    "",
    "The idea is simple — a space where you can brainstorm exam strategies with other serious candidates, and also get paired for 1v1 Duels directly in the group instead of waiting to be matched on the app.",
    "",
    `Join here: ${WHATSAPP_GROUP_URL}`,
    "",
    "See you inside,",
    "Marvellous",
    "Founder, StudyBond",
  ].join("\n");

  const html = `
    <div style="font-family: Arial, sans-serif; line-height: 1.7; color: #1a1a1a; max-width: 580px; margin: 0 auto; padding: 24px;">
      <p style="font-size: 15px; margin: 0 0 16px;">Hey ${escapeHtml(firstName)},</p>

      <p style="font-size: 15px; margin: 0 0 16px;">Since you're on the paid plan, I want to personally invite you to a WhatsApp group we just set up for paid subscribers.</p>

      <p style="font-size: 15px; margin: 0 0 16px;">The idea is simple — a space where you can brainstorm exam strategies with other serious candidates, and also get paired for 1v1 Duels directly in the group instead of waiting to be matched on the app.</p>

      <p style="font-size: 15px; margin: 0 0 16px;">Join here: <a href="${escapeHtml(WHATSAPP_GROUP_URL)}" style="color: #1a73e8; text-decoration: underline;">${escapeHtml(WHATSAPP_GROUP_URL)}</a></p>

      <p style="font-size: 15px; margin: 24px 0 0;">
        See you inside,<br/>
        Marvellous<br/>
        <span style="color: #6b7280; font-size: 14px;">Founder, StudyBond</span>
      </p>
    </div>
  `;

  return {
    subject: "Private group for paid subscribers",
    text,
    html,
  };
}

async function sendBroadcastEmailViaBrevo(
  user: { id: number; email: string; fullName: string },
  email: { subject: string; html: string; text: string },
) {
  try {
    const result = await brevoProvider.send({
      from: { email: FROM_ADDRESS, name: FROM_NAME },
      to: { email: user.email, name: user.fullName },
      subject: email.subject,
      html: email.html,
      text: email.text,
    });

    await prisma.emailLog.create({
      data: {
        userId: user.id,
        emailType: EmailType.SERVICE_NOTICE,
        provider: EmailProvider.BREVO,
        recipientEmail: user.email,
        subject: email.subject,
        status: "sent",
        emailServiceId: result.messageId,
        metadata: {
          broadcastId: BROADCAST_ID,
          campaignKind: "premium_whatsapp_group",
          forcedProvider: "BREVO",
        },
      },
    });

    return { deliveryMode: "BREVO" as const, messageId: result.messageId };
  } catch (error) {
    const providerError =
      error instanceof EmailProviderError
        ? error
        : new EmailProviderError(
            (error as Error).message || "Brevo request failed unexpectedly.",
            {
              code: "BREVO_BROADCAST_FAILED",
              retryable: false,
            },
          );

    await prisma.emailLog.create({
      data: {
        userId: user.id,
        emailType: EmailType.SERVICE_NOTICE,
        provider: EmailProvider.BREVO,
        recipientEmail: user.email,
        subject: email.subject,
        status: "failed",
        errorMessage: providerError.message,
        metadata: {
          broadcastId: BROADCAST_ID,
          campaignKind: "premium_whatsapp_group",
          forcedProvider: "BREVO",
          code: providerError.code,
          statusCode: providerError.statusCode,
          retryable: providerError.retryable,
        },
      },
    });

    throw providerError;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const dryRun = args.send !== true && process.env.DRY_RUN !== "false";
  const emailFilter = args.email
    ? String(args.email).trim().toLowerCase()
    : null;

  console.log(`\n📧 PREMIUM WHATSAPP GROUP BROADCAST (v2)`);
  console.log(
    `   Mode: ${dryRun ? "🔒 DRY RUN (pass --send or set DRY_RUN=false to send)" : "🚀 LIVE SEND"}`,
  );
  console.log(`   Broadcast ID: ${BROADCAST_ID}`);
  console.log(`   Batch size: ${BATCH_SIZE}`);
  console.log(`   From: ${FROM_NAME} <${FROM_ADDRESS}>`);
  if (emailFilter) {
    console.log(`   Filter by email: ${emailFilter}`);
  }
  console.log("");

  // 1. Find the target user for testing, or otherwise all verified, non-banned premium users
  const premiumUsers = await prisma.user.findMany({
    where: emailFilter
      ? {
          email: { equals: emailFilter, mode: "insensitive" },
        }
      : {
          isPremium: true,
          isVerified: true,
          isBanned: false,
        },
    select: {
      id: true,
      email: true,
      fullName: true,
    },
    orderBy: { id: "asc" },
  });

  console.log(
    `   Found ${premiumUsers.length} ${emailFilter ? "matching user" : "eligible premium users"}`,
  );

  if (premiumUsers.length === 0) {
    console.log(
      emailFilter
        ? `   No user found for ${emailFilter}. Exiting.`
        : "   No premium users found. Exiting.",
    );
    process.exit(0);
  }

  // 2. Check who already received this broadcast (idempotent re-runs)
  const alreadySent = emailFilter
    ? new Set<number>()
    : new Set(
        (
          await prisma.emailLog.findMany({
            where: {
              emailType: EmailType.SERVICE_NOTICE,
              status: "sent",
              metadata: {
                path: ["broadcastId"],
                equals: BROADCAST_ID,
              },
            },
            select: { userId: true },
          })
        ).map((row: { userId: number }) => row.userId),
      );

  const toSend = premiumUsers.filter(
    (u: { id: number }) => !alreadySent.has(u.id),
  );

  if (emailFilter) {
    console.log(`   Targeted recipient count: ${toSend.length}`);
  } else {
    console.log(`   Already sent: ${alreadySent.size}`);
    console.log(`   Remaining: ${toSend.length}`);
  }
  console.log("");

  if (toSend.length === 0) {
    const message = emailFilter
      ? `   No matching user was available to send to. Exiting.`
      : "   ✅ All eligible premium users already received this broadcast. Exiting.";
    console.log(message);
    process.exit(0);
  }

  // 3. Send in batches
  let sent = 0;
  let failed = 0;

  for (let i = 0; i < toSend.length; i += BATCH_SIZE) {
    const batch = toSend.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(toSend.length / BATCH_SIZE);

    console.log(
      `   Batch ${batchNum}/${totalBatches} (${batch.length} users)...`,
    );

    for (const user of batch) {
      const email = buildBroadcastEmail(user.fullName);

      if (dryRun) {
        console.log(
          `     [DRY] Would send to: ${user.email} (${user.fullName})`,
        );
        sent += 1;
        continue;
      }

      try {
        const result = await sendBroadcastEmailViaBrevo(user, email);

        console.log(`     🚀 [SENT via ${result.deliveryMode}] ${user.email}`);
        sent += 1;
      } catch (err) {
        failed += 1;
        console.error(
          `     ❌ Failed: ${user.email} — ${err instanceof Error ? err.message : "Unknown error"}`,
        );
      }
    }

    // Delay between batches to avoid rate limits
    if (i + BATCH_SIZE < toSend.length) {
      await sleep(BATCH_DELAY_MS);
    }
  }

  console.log("");
  console.log(`   ✅ Done!`);
  console.log(`   Sent: ${sent}`);
  console.log(`   Failed: ${failed}`);
  console.log(`   Total premium users: ${premiumUsers.length}`);

  if (dryRun) {
    console.log("");
    console.log("   ⚠️  This was a DRY RUN. No emails were actually sent.");
    console.log(
      "   To send for real, run: npm run send:premium-whatsapp-group -- --send",
    );
  }

  process.exit(0);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
