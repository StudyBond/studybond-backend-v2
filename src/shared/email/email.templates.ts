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
