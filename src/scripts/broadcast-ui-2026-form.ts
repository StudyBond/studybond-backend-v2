/**

 * ONE-OFF BROADCAST: UI 2026 Post-UTME Form Release Announcement

 *

 * Sends the announcement to all verified, non-banned users.

 * Run with: npx tsx src/scripts/broadcast-ui-2026-form.ts

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



const BROADCAST_ID = 'ui_2026_post_utme_form_release_v1';

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

  const dashboardUrl =

    'https://studybond.app/dashboard?utm_source=email&utm_campaign=ui_2026_release';



  return {

    subject: 'UI Post-UTME 2026: Registration & CBT Dates Released',



    text: [

      `Hi ${firstName},`,

      '',

      'The wait is over.',

      '',

      'The University of Ibadan (UI) has officially released the registration schedule and CBT screening dates for the 2026/2027 admission exercise.',

      '',

      'If you chose UI as your first choice and scored 200 or above in JAMB, here are the key dates you should not miss:',

      '',

      '• Registration opens: Monday, 22 June 2026',

      '• Registration closes: Sunday, 19 July 2026',

      '• CBT screening exams: Monday, 27 July 2026 to Wednesday, 29 July 2026',

      '',

      'UI Registrar G. O. Saliu has made it clear that there will be no extension of the registration period, so make sure you complete your application before the deadline through the official admissions portal (admissions.ui.edu.ng).',

      '',

      'With the CBT exams scheduled for July 27–29, we now have about 6 weeks left.',

      '',

      "If you've been waiting for the right time to take your preparation seriously, this is it.",

      '',

      'When you log in to your StudyBond dashboard, you will see our live countdown showing exactly how many days remain before the exam. Use it as a daily reminder to stay consistent and keep moving forward.',

      '',

      'Six weeks may sound short, but it is still enough time to make a huge difference if you stay disciplined.',

      '',

      'Daily practice remains one of the fastest ways to improve your speed, accuracy, and confidence. The more questions you solve under timed conditions, the more comfortable the actual exam becomes.',

      '',

      'Log in today, take a mock test, maintain your study streak, and keep building momentum.',

      '',

      `Go to your dashboard: ${dashboardUrl}`,

      '',

      'We are rooting for you.',

      '',

      "Let's make 2026 the year you secure your UI admission.",

      '',

      'Best regards,',

      'Marvellous',

      'Founder, StudyBond',

    ].join('\n'),



    html: `

      <div style="font-family: Georgia, 'Times New Roman', serif; line-height: 1.8; color: #1a1a1a; max-width: 580px; margin: 0 auto; padding: 24px 16px;">

        <p style="font-size: 16px;">Hi ${escapeHtml(firstName)},</p>



        <p style="font-size: 16px;"><strong>The wait is over.</strong></p>



        <p style="font-size: 16px;">

          The University of Ibadan (UI) has officially released the registration schedule and CBT screening dates for the 2026/2027 admission exercise.

        </p>



        <p style="font-size: 16px;">

          If you chose UI as your first choice and scored 200 or above in JAMB, here are the key dates you should not miss:

        </p>



        <ul style="font-size: 16px; padding-left: 20px; margin: 16px 0;">

          <li style="margin-bottom: 8px;">

            <strong>Registration opens:</strong> Monday, 22 June 2026

          </li>



          <li style="margin-bottom: 8px;">

            <strong>Registration closes:</strong> Sunday, 19 July 2026

          </li>



          <li style="margin-bottom: 8px;">

            <strong>CBT screening exams:</strong> Monday, 27 July 2026 to Wednesday, 29 July 2026

          </li>

        </ul>



        <p style="font-size: 16px;">

          UI Registrar G. O. Saliu has made it clear that there will be <strong>no extension</strong> of the registration period, so make sure you complete your application before the deadline through the official admissions portal

          (<a href="https://admissions.ui.edu.ng" style="color: #e09040; text-decoration: underline;">admissions.ui.edu.ng</a>).

        </p>



        <p style="font-size: 16px;">

          With the CBT exams scheduled for July 27–29, we now have about 6 weeks left.

        </p>



        <p style="font-size: 16px;">

          <strong>If you've been waiting for the right time to take your preparation seriously, this is it.</strong>

        </p>



        <p style="font-size: 16px;">

          When you log in to your StudyBond dashboard, you will see our live countdown showing exactly how many days remain before the exam. Use it as a daily reminder to stay consistent and keep moving forward.

        </p>



        <p style="font-size: 16px;">

          Six weeks may sound short, but it is still enough time to make a huge difference if you stay disciplined.

        </p>



        <p style="font-size: 16px;">

          Daily practice remains one of the fastest ways to improve your speed, accuracy, and confidence. The more questions you solve under timed conditions, the more comfortable the actual exam becomes.

        </p>



        <p style="font-size: 16px;">

          Log in today, take a mock test, maintain your study streak, and keep building momentum.

        </p>



        <div style="margin: 32px 0;">

          <a

            href="${escapeHtml(dashboardUrl)}"

            style="display: inline-block; padding: 12px 28px; background: #e09040; color: #09090b; text-decoration: none; border-radius: 8px; font-weight: 700; font-size: 15px; font-family: Arial, sans-serif;"

          >

            Go to StudyBond Dashboard

          </a>

        </div>



        <p style="font-size: 16px;">We are rooting for you.</p>



        <p style="font-size: 16px;">

          Let's make 2026 the year you secure your UI admission.

        </p>



        <div style="margin-top: 32px; border-top: 1px solid #e5e7eb; padding-top: 16px;">

          <p style="font-size: 15px; margin: 0;">

            <strong>Marvellous</strong>

          </p>



          <p style="font-size: 14px; color: #6b7280; margin: 4px 0 0 0;">

            Founder, StudyBond

          </p>

        </div>

      </div>

    `,

  };

} 



function sleep(ms: number): Promise<void> {

  return new Promise(resolve => setTimeout(resolve, ms));

}



async function main() {

  console.log(`\n📧 UI 2026 POST-UTME FORM RELEASE ANNOUNCEMENT BROADCAST`);

  console.log(`   Mode: ${DRY_RUN ? '🔒 DRY RUN (set DRY_RUN=false to send)' : '🚀 LIVE SEND'}`);

  console.log(`   Broadcast ID: ${BROADCAST_ID}`);

  console.log(`   Batch size: ${BATCH_SIZE}`);

  console.log('');



  // 1. Find all verified, non-banned users who are not unsubscribed (both free & premium)

  const users = await prisma.user.findMany({

    where: {

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



  console.log(`   Found ${users.length} eligible users`);



  if (users.length === 0) {

    console.log('   No eligible users found. Exiting.');

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

          subject: email.subject,

          html: email.html,

          text: email.text,

          metadata: {

            broadcastId: BROADCAST_ID,

            campaignKind: 'system_notice',

            promoType: 'ui_2026_exam_release',

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



  if (DRY_RUN) {

    console.log('');

    console.log('   ⚠️  This was a DRY RUN. No emails were actually sent.');

    console.log('   To send for real, run: DRY_RUN=false npx tsx src/scripts/broadcast-ui-2026-form.ts');

  }



  process.exit(0);

}



main().catch(err => {

  console.error('Fatal error:', err);

  process.exit(1);

});