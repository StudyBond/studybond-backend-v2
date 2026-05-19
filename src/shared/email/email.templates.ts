import { EmailTemplate } from './email.types';

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function buildOtpShell(title: string, intro: string, otp: string, extraLine?: string): EmailTemplate {
  const safeTitle = escapeHtml(title);
  const safeIntro = escapeHtml(intro);
  const safeOtp = escapeHtml(otp);
  const safeExtraLine = extraLine ? escapeHtml(extraLine) : '';

  return {
    subject: title,
    text: `${intro}\n\nCode: ${otp}${extraLine ? `\n${extraLine}` : ''}\n\nIf you did not request this, you can ignore this email.`,
    html: `
      <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #111827; max-width: 560px; margin: 0 auto; padding: 24px;">
        <h2 style="margin-bottom: 16px;">${safeTitle}</h2>
        <p>${safeIntro}</p>
        <div style="margin: 24px 0; padding: 16px; background: #f3f4f6; border-radius: 12px; text-align: center;">
          <span style="font-size: 32px; font-weight: 700; letter-spacing: 6px;">${safeOtp}</span>
        </div>
        ${safeExtraLine ? `<p>${safeExtraLine}</p>` : ''}
        <p style="color: #4b5563;">If you did not request this, you can ignore this email.</p>
      </div>
    `
  };
}

export function buildEmailVerificationOtpTemplate(fullName: string, otp: string): EmailTemplate {
  const firstName = fullName.trim().split(/\s+/)[0] || 'there';
  return buildOtpShell(
    'Verify your StudyBond email',
    `Hi ${firstName}, use this code to verify your StudyBond account.`,
    otp,
    'This code expires in 15 minutes.'
  );
}

export function buildPremiumDeviceOtpTemplate(fullName: string, otp: string, deviceName?: string): EmailTemplate {
  const firstName = fullName.trim().split(/\s+/)[0] || 'there';
  const extra = deviceName
    ? `Approve the premium login for ${deviceName}. This code expires in 15 minutes.`
    : 'Approve your premium device login. This code expires in 15 minutes.';

  return buildOtpShell(
    'Approve your StudyBond premium device',
    `Hi ${firstName}, use this code to approve a premium device sign-in.`,
    otp,
    extra
  );
}

export function buildPasswordResetOtpTemplate(fullName: string, otp: string): EmailTemplate {
  const firstName = fullName.trim().split(/\s+/)[0] || 'there';
  return buildOtpShell(
    'Reset your StudyBond password',
    `Hi ${firstName}, use this code to reset your StudyBond password.`,
    otp,
    'This code expires in 10 minutes. If you did not request a password reset, ignore this email and keep your account secure.'
  );
}

export function buildAdminStepUpOtpTemplate(fullName: string, otp: string): EmailTemplate {
  const firstName = fullName.trim().split(/\s+/)[0] || 'there';
  return buildOtpShell(
    'Approve your StudyBond superadmin action',
    `Hi ${firstName}, use this code to unlock a sensitive superadmin action on your current session.`,
    otp,
    'This code expires in 10 minutes.'
  );
}

export function buildPasswordChangedAlertTemplate(
  fullName: string,
  passwordChangeCount: number,
  latestChangedAt: Date
): EmailTemplate {
  const firstName = fullName.trim().split(/\s+/)[0] || 'there';
  const changeLabel = passwordChangeCount === 1
    ? 'your StudyBond password was changed'
    : `your StudyBond password was changed ${passwordChangeCount} times`;
  const changedAtLabel = latestChangedAt.toLocaleString('en-NG', {
    dateStyle: 'medium',
    timeStyle: 'short'
  });

  return {
    subject: 'StudyBond password change notice',
    text: [
      `Hi ${firstName},`,
      '',
      `We noticed that ${changeLabel}.`,
      `Latest change time: ${changedAtLabel}.`,
      '',
      'If this was you, no action is needed.',
      'If this was not you, reset your password immediately and contact StudyBond support.'
    ].join('\n'),
    html: `
      <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #111827; max-width: 560px; margin: 0 auto; padding: 24px;">
        <h2 style="margin-bottom: 16px;">StudyBond password change notice</h2>
        <p>Hi ${escapeHtml(firstName)},</p>
        <p>We noticed that ${escapeHtml(changeLabel)}.</p>
        <p><strong>Latest change time:</strong> ${escapeHtml(changedAtLabel)}</p>
        <p>If this was you, no action is needed.</p>
        <p style="color: #b91c1c; font-weight: 600;">If this was not you, reset your password immediately and contact StudyBond support.</p>
      </div>
    `
  };
}

export function buildStreakAlertTemplate(
  fullName: string,
  currentStreak: number,
  reminderMessage: string,
  nextMilestoneLabel?: string | null
): EmailTemplate {
  const firstName = fullName.trim().split(/\s+/)[0] || 'there';
  const safeMessage = escapeHtml(reminderMessage);
  const safeMilestone = nextMilestoneLabel ? escapeHtml(nextMilestoneLabel) : null;

  return {
    subject: `Keep your ${currentStreak}-day StudyBond streak alive`,
    text: [
      `Hi ${firstName},`,
      '',
      reminderMessage,
      safeMilestone ? `Next milestone: ${nextMilestoneLabel}.` : '',
      'Study for a few minutes before today ends to protect your streak.'
    ].filter(Boolean).join('\n'),
    html: `
      <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #111827; max-width: 560px; margin: 0 auto; padding: 24px;">
        <h2 style="margin-bottom: 16px;">Your ${currentStreak}-day streak is still alive</h2>
        <p>Hi ${escapeHtml(firstName)},</p>
        <p>${safeMessage}</p>
        ${safeMilestone ? `<p><strong>Next milestone:</strong> ${safeMilestone}</p>` : ''}
        <p>Take a quick exam before today ends and keep the streak going.</p>
      </div>
    `
  };
}

export function buildSubscriptionPromptTemplate(
  fullName: string,
  currentStreak: number,
  aspiringCourse?: string | null,
  targetScore?: number | null
): EmailTemplate {
  const firstName = fullName.trim().split(/\s+/)[0] || 'there';
  const courseLine = aspiringCourse
    ? `You are still building toward ${aspiringCourse}.`
    : 'You are still building toward your exam goal.';
  const targetLine = targetScore
    ? `Your target score is ${targetScore}.`
    : null;

  return {
    subject: 'Unlock premium to keep your StudyBond momentum',
    text: [
      `Hi ${firstName},`,
      '',
      `You already built a ${currentStreak}-day StudyBond streak.`,
      courseLine,
      targetLine,
      '',
      'Upgrade to premium to unlock more exams, save your momentum, and keep pushing forward.'
    ].filter(Boolean).join('\n'),
    html: `
      <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #111827; max-width: 560px; margin: 0 auto; padding: 24px;">
        <h2 style="margin-bottom: 16px;">Keep your StudyBond momentum going</h2>
        <p>Hi ${escapeHtml(firstName)},</p>
        <p>You already built a <strong>${currentStreak}-day streak</strong> on StudyBond.</p>
        <p>${escapeHtml(courseLine)}</p>
        ${targetLine ? `<p>${escapeHtml(targetLine)}</p>` : ''}
        <p>Upgrade to premium to unlock more exams, protect your momentum, and keep improving.</p>
      </div>
    `
  };
}

// ============================================
// MARKETING CAMPAIGN TEMPLATES
// ============================================

function buildUnsubscribeFooter(appBaseUrl: string): { text: string; html: string } {
  const unsubUrl = `${appBaseUrl}/settings/notifications?unsubscribe=marketing`;
  return {
    text: `\n\n---\nYou are receiving this because you signed up for StudyBond.\nUnsubscribe from marketing emails: ${unsubUrl}`,
    html: `
      <div style="margin-top: 32px; padding-top: 16px; border-top: 1px solid #e5e7eb; font-size: 12px; color: #9ca3af;">
        You are receiving this because you signed up for StudyBond.<br/>
        <a href="${escapeHtml(unsubUrl)}" style="color: #6b7280; text-decoration: underline;">Unsubscribe from marketing emails</a>
      </div>
    `
  };
}

function buildCtaButton(label: string, href: string): string {
  return `
    <div style="margin: 24px 0; text-align: center;">
      <a href="${escapeHtml(href)}" style="display: inline-block; padding: 12px 28px; background: #4f46e5; color: #ffffff; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 15px;">${escapeHtml(label)}</a>
    </div>
  `;
}

export function buildWelcomeEmailTemplate(
  fullName: string,
  aspiringCourse?: string | null,
  appBaseUrl = 'https://studybond.app'
): EmailTemplate {
  const firstName = fullName.trim().split(/\s+/)[0] || 'there';
  const courseMention = aspiringCourse
    ? ` You told us you are preparing for ${aspiringCourse} — we have got you covered.`
    : '';
  const dashboardUrl = `${appBaseUrl}/dashboard?utm_source=email&utm_campaign=welcome`;
  const footer = buildUnsubscribeFooter(appBaseUrl);

  return {
    subject: `Welcome to StudyBond, ${firstName}!`,
    text: [
      `Hi ${firstName},`,
      '',
      `Welcome to StudyBond!${aspiringCourse ? ` You told us you are preparing for ${aspiringCourse} — we have got you covered.` : ''}`,
      '',
      'Here is what you can do right now:',
      '• Take practice and real past-question exams',
      '• Build a study streak and climb the leaderboard',
      '• Challenge friends in 1v1 duels',
      '',
      `Start your first exam: ${dashboardUrl}`,
      footer.text
    ].join('\n'),
    html: `
      <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #111827; max-width: 560px; margin: 0 auto; padding: 24px;">
        <h2 style="margin-bottom: 16px;">Welcome to StudyBond!</h2>
        <p>Hi ${escapeHtml(firstName)},</p>
        <p>We are glad to have you.${escapeHtml(courseMention)}</p>
        <p>Here is what you can do right now:</p>
        <ul style="padding-left: 20px; margin: 12px 0;">
          <li>Take practice and real past-question exams</li>
          <li>Build a study streak and climb the leaderboard</li>
          <li>Challenge friends in 1v1 duels</li>
        </ul>
        ${buildCtaButton('Take your first exam', dashboardUrl)}
        <p style="color: #6b7280; font-size: 14px;">Good luck with your preparation!</p>
        ${footer.html}
      </div>
    `
  };
}

export function buildInactivityNudgeTemplate(
  fullName: string,
  daysSinceSignup: number,
  aspiringCourse?: string | null,
  appBaseUrl = 'https://studybond.app'
): EmailTemplate {
  const firstName = fullName.trim().split(/\s+/)[0] || 'there';
  const daysLabel = daysSinceSignup === 1 ? '1 day' : `${daysSinceSignup} days`;
  const courseLine = aspiringCourse
    ? `You told us you are working toward ${aspiringCourse}. Every practice session counts.`
    : 'Every practice session counts toward your exam goal.';
  const dashboardUrl = `${appBaseUrl}/dashboard?utm_source=email&utm_campaign=inactivity_nudge`;
  const footer = buildUnsubscribeFooter(appBaseUrl);

  return {
    subject: 'Your StudyBond account is waiting for you',
    text: [
      `Hi ${firstName},`,
      '',
      `You signed up for StudyBond ${daysLabel} ago, but you have not taken your first exam yet.`,
      courseLine,
      '',
      'Thousands of students are already practicing. A quick exam takes just a few minutes.',
      '',
      `Start now: ${dashboardUrl}`,
      footer.text
    ].join('\n'),
    html: `
      <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #111827; max-width: 560px; margin: 0 auto; padding: 24px;">
        <h2 style="margin-bottom: 16px;">Your account is waiting for you</h2>
        <p>Hi ${escapeHtml(firstName)},</p>
        <p>You signed up for StudyBond <strong>${escapeHtml(daysLabel)} ago</strong>, but you have not taken your first exam yet.</p>
        <p>${escapeHtml(courseLine)}</p>
        <p>Thousands of students are already practicing. A quick exam takes just a few minutes.</p>
        ${buildCtaButton('Take your first exam', dashboardUrl)}
        ${footer.html}
      </div>
    `
  };
}

export function buildMilestoneCelebrationTemplate(
  fullName: string,
  milestoneLabel: string,
  examCount: number,
  appBaseUrl = 'https://studybond.app'
): EmailTemplate {
  const firstName = fullName.trim().split(/\s+/)[0] || 'there';
  const dashboardUrl = `${appBaseUrl}/dashboard?utm_source=email&utm_campaign=milestone`;
  const footer = buildUnsubscribeFooter(appBaseUrl);

  return {
    subject: `You just hit ${examCount} exams on StudyBond!`,
    text: [
      `Hi ${firstName},`,
      '',
      `Congratulations! You have completed ${examCount} exams on StudyBond. That is a serious milestone.`,
      '',
      'Most students never make it this far. Your consistency is paying off.',
      '',
      'Want unlimited exams, streak freezes, and AI explanations? Premium unlocks everything.',
      '',
      `Keep going: ${dashboardUrl}`,
      footer.text
    ].join('\n'),
    html: `
      <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #111827; max-width: 560px; margin: 0 auto; padding: 24px;">
        <h2 style="margin-bottom: 16px;">${escapeHtml(milestoneLabel)}</h2>
        <p>Hi ${escapeHtml(firstName)},</p>
        <p>Congratulations! You have completed <strong>${examCount} exams</strong> on StudyBond. That is a serious milestone.</p>
        <p>Most students never make it this far. Your consistency is paying off.</p>
        <p style="color: #4b5563;">Want unlimited exams, streak freezes, and AI explanations? <strong>Premium unlocks everything.</strong></p>
        ${buildCtaButton('Keep practising', dashboardUrl)}
        ${footer.html}
      </div>
    `
  };
}

