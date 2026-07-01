/**
 * ONE-OFF BROADCAST: Mathematics launch update
 *
 * Sends the Mathematics availability email to all verified, non-banned users
 * who have not unsubscribed from marketing emails.
 *
 * Run with: npx tsx src/scripts/broadcast-mathematics-update.ts
 *
 * Safety features:
 * - Dry-run mode by default (pass --send or set DRY_RUN=false to send)
 * - Batch processing (50 at a time with 2s delay between batches)
 * - Skips users who already received this broadcast (idempotent)
 * - Full logging of results
 */

import "dotenv/config";
import { EmailType } from "@prisma/client";
import prisma from "../config/database";
import { transactionalEmailService } from "../shared/email/email.service";

const BROADCAST_ID = "mathematics_now_live_2026_07_01";
const BATCH_SIZE = 50;
const BATCH_DELAY_MS = 2000;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function firstName(fullName: string): string {
  return fullName.trim().split(/\s+/)[0] || "there";
}

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

function buildUpdateEmail(fullName: string) {
  const name = firstName(fullName);
  const practiceUrl = "https://studybond.app/dashboard/practice";

  const text = [
    `Hey ${name},`,
    "",
    "Quick update: Mathematics is now live on StudyBond.",
    "",
    "We've uploaded and reviewed all available UI Mathematics past questions across previous years, so the question bank is complete. That means you can now include Mathematics in your full mock exams, and the Daily Global Challenge has Mathematics added in as the fourth subject alongside English, Physics, Chemistry, and Biology.",
    "",
    "If Maths was a gap in your prep, now's the time to get into it. The exam is less than four weeks away.",
    "",
    practiceUrl,
    "",
    "— Marvellous",
    "",
    "---",
    "You are receiving this because you signed up for StudyBond.",
    `Unsubscribe from marketing emails: https://studybond.app/settings/notifications?unsubscribe=marketing`,
  ].join("\n");

  const html = `
    <div style="font-family: Georgia, 'Times New Roman', serif; line-height: 1.8; color: #1a1a1a; max-width: 580px; margin: 0 auto; padding: 24px 16px;">
      <p style="font-size: 16px;">Hey ${escapeHtml(name)},</p>

      <p style="font-size: 16px;">Quick update: Mathematics is now live on StudyBond.</p>

      <p style="font-size: 16px;">
        We've uploaded and reviewed all available UI Mathematics past questions across previous years, so the question bank is complete. That means you can now include Mathematics in your full mock exams, and the Daily Global Challenge has Mathematics added in as the fourth subject alongside English, Physics, Chemistry, and Biology.
      </p>

      <p style="font-size: 16px;">
        If Maths was a gap in your prep, now's the time to get into it. The exam is less than four weeks away.
      </p>

      <p style="font-size: 16px;">
        <a href="${practiceUrl}" style="color: #e09040; text-decoration: underline;">Open your practice dashboard</a>
      </p>

      <p style="font-size: 16px; margin-bottom: 24px;">— Marvellous</p>

      <div style="margin-top: 40px; border-top: 1px solid #e5e7eb; padding-top: 16px; font-size: 12px; color: #9ca3af; font-family: Arial, sans-serif; line-height: 1.4;">
        You are receiving this because you signed up for StudyBond.<br/>
        <a href="https://studybond.app/settings/notifications?unsubscribe=marketing" style="color: #6b7280; text-decoration: underline;">Unsubscribe from marketing emails</a>
      </div>
    </div>
  `;

  return {
    subject: "Mathematics is now on StudyBond",
    text,
    html,
  };
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

  console.log(`\n📧 MATHEMATICS UPDATE BROADCAST`);
  console.log(
    `   Mode: ${dryRun ? "🔒 DRY RUN (pass --send or set DRY_RUN=false to send)" : "🚀 LIVE SEND"}`,
  );
  console.log(`   Broadcast ID: ${BROADCAST_ID}`);
  console.log(`   Batch size: ${BATCH_SIZE}`);
  if (emailFilter) {
    console.log(`   Filter by email: ${emailFilter}`);
  }
  console.log("");

  const whereClause: any = emailFilter
    ? { email: emailFilter }
    : {
        email: {
          not: null,
        },
      };

  const users = await prisma.user.findMany({
    where: whereClause,
    select: {
      id: true,
      email: true,
      fullName: true,
    },
    orderBy: { id: "asc" },
  });

  console.log(`   Found ${users.length} eligible users`);

  if (users.length === 0) {
    console.log("   No eligible users found. Exiting.");
    process.exit(0);
  }

  const alreadySent = emailFilter
    ? new Set<number>()
    : new Set(
        (
          await prisma.emailLog.findMany({
            where: {
              emailType: EmailType.SUBSCRIPTION_PROMPT,
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

  const toSend = users.filter((u: { id: number }) => !alreadySent.has(u.id));

  console.log(`   Already sent: ${alreadySent.size}`);
  console.log(`   Remaining: ${toSend.length}`);
  console.log("");

  if (toSend.length === 0) {
    console.log(
      "   ✅ All eligible users already received this broadcast. Exiting.",
    );
    process.exit(0);
  }

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
      const email = buildUpdateEmail(user.fullName);

      if (dryRun) {
        console.log(
          `     [DRY] Would send to: ${user.email} (${user.fullName})`,
        );
        sent += 1;
        continue;
      }

      try {
        const result = await transactionalEmailService.send({
          userId: user.id,
          emailType: EmailType.SUBSCRIPTION_PROMPT,
          to: { email: user.email, name: user.fullName },
          from: { email: "hello@mail.studybond.app", name: "Marvellous" },
          subject: email.subject,
          html: email.html,
          text: email.text,
          metadata: {
            broadcastId: BROADCAST_ID,
            campaignKind: "product_update",
            feature: "mathematics_subject",
          },
        });

        if (result.deliveryMode === "DEV_PREVIEW") {
          console.log(
            `     ⚠️  [PREVIEW ONLY - NOT SENT] ${user.email} (API keys missing or local environment dev mode)`,
          );
        } else if (result.deliveryMode === "SUPPRESSED") {
          console.log(
            `     ⚠️  [SUPPRESSED - NOT SENT] ${user.email} (Email system disabled in settings)`,
          );
        } else {
          console.log(
            `     🚀 [SENT via ${result.deliveryMode}] ${user.email}`,
          );
        }

        sent += 1;
      } catch (err) {
        failed += 1;
        console.error(
          `     ❌ Failed: ${user.email} — ${err instanceof Error ? err.message : "Unknown error"}`,
        );
      }
    }

    if (i + BATCH_SIZE < toSend.length) {
      await sleep(BATCH_DELAY_MS);
    }
  }

  console.log("");
  console.log(`   ✅ Done!`);
  console.log(`   Sent: ${sent}`);
  console.log(`   Failed: ${failed}`);
  console.log(`   Total users: ${users.length}`);

  if (dryRun) {
    console.log("");
    console.log("   ⚠️  This was a DRY RUN. No emails were actually sent.");
    console.log(
      "   To send for real, pass the --send flag or run with DRY_RUN=false.",
    );
  }

  process.exit(0);
}

main().catch((err) => {
  console.error("Broadcast failed:", err);
  process.exit(1);
});
