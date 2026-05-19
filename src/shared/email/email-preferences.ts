import { EmailType } from '@prisma/client';

/**
 * Email Preference Categories
 *
 * Security emails (OTPs, password alerts) are ALWAYS delivered and cannot be
 * disabled. Marketing and streak-alert categories are independently togglable
 * by the user.
 */
export interface EmailPreferences {
  /** OTP / password alerts — always true, cannot be overridden. */
  security: true;
  /** Premium streak-at-risk reminders. */
  streakAlerts: boolean;
  /** Welcome emails, inactivity nudges, milestone celebrations, subscription prompts. */
  marketing: boolean;
}

const DEFAULT_PREFERENCES: EmailPreferences = {
  security: true,
  streakAlerts: true,
  marketing: true,
};

const MARKETING_EMAIL_TYPES: ReadonlySet<EmailType> = new Set([
  EmailType.WELCOME_EMAIL,
  EmailType.SUBSCRIPTION_PROMPT,
  EmailType.INACTIVITY_NUDGE,
  EmailType.MILESTONE_CELEBRATION,
]);

const STREAK_ALERT_EMAIL_TYPES: ReadonlySet<EmailType> = new Set([
  EmailType.STREAK_ALERT,
  EmailType.EVENING_REMINDER,
]);

/**
 * Resolves a user's effective email preferences by merging the stored JSON
 * field with defaults, and honouring the legacy `emailUnsubscribed` flag.
 *
 * If `emailUnsubscribed` is true and no `emailPreferences` JSON is stored,
 * the marketing category is disabled (backward-compat).
 */
export function resolveEmailPreferences(user: {
  emailUnsubscribed: boolean;
  emailPreferences?: unknown;
}): EmailPreferences {
  const stored = (typeof user.emailPreferences === 'object' && user.emailPreferences !== null)
    ? user.emailPreferences as Partial<EmailPreferences>
    : {};

  // If the user set preferences explicitly, use them; otherwise fall back to
  // the legacy boolean for the marketing category.
  const marketing = typeof stored.marketing === 'boolean'
    ? stored.marketing
    : !user.emailUnsubscribed;

  const streakAlerts = typeof stored.streakAlerts === 'boolean'
    ? stored.streakAlerts
    : DEFAULT_PREFERENCES.streakAlerts;

  return {
    security: true,
    streakAlerts,
    marketing,
  };
}

/**
 * Returns `true` when the user may receive marketing-category emails
 * (welcome, nudge, milestone, subscription prompt).
 */
export function canReceiveMarketingEmail(user: {
  emailUnsubscribed: boolean;
  emailPreferences?: unknown;
}): boolean {
  return resolveEmailPreferences(user).marketing;
}

/**
 * Returns `true` when the user may receive streak-alert emails.
 */
export function canReceiveStreakAlert(user: {
  emailUnsubscribed: boolean;
  emailPreferences?: unknown;
}): boolean {
  return resolveEmailPreferences(user).streakAlerts;
}

/**
 * Returns `true` when the given email type is permitted by the user's
 * current preferences.
 */
export function isEmailTypeAllowed(
  emailType: EmailType,
  user: { emailUnsubscribed: boolean; emailPreferences?: unknown }
): boolean {
  if (MARKETING_EMAIL_TYPES.has(emailType)) {
    return canReceiveMarketingEmail(user);
  }

  if (STREAK_ALERT_EMAIL_TYPES.has(emailType)) {
    return canReceiveStreakAlert(user);
  }

  // Security and uncategorised types are always allowed.
  return true;
}
