
function parsePositiveInt(value: string | undefined, fallback: number): number {
    const parsed = Number.parseInt(value || '', 10);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function parseBoolean(value: string | undefined, fallback = false): boolean {
    if (typeof value !== 'string') return fallback;

    const normalized = value.trim().toLowerCase();
    if (normalized === 'true') return true;
    if (normalized === 'false') return false;
    return fallback;
}

export const AUTH_CONFIG = {
    JWT_EXPIRY: process.env.JWT_EXPIRY || '15m',
    REFRESH_TOKEN_EXPIRY: process.env.REFRESH_TOKEN_EXPIRY || '30d',
    SALT_ROUNDS: 10,
    OTP_EXPIRY_MS: 15 * 60 * 1000, // 15 minutes
    EMAIL_VERIFICATION_RESEND_COOLDOWN_MS: parsePositiveInt(process.env.AUTH_VERIFICATION_RESEND_COOLDOWN_SECONDS, 60) * 1000,
    PASSWORD_RESET_OTP_EXPIRY_MS: parsePositiveInt(process.env.AUTH_PASSWORD_RESET_OTP_EXPIRY_SECONDS, 10 * 60) * 1000,
    SESSION_EXPIRY_MS: 30 * 24 * 60 * 60 * 1000, // 30 days
    MAX_DEVICES: 2,
    MAX_OTP_REQUESTS_DAILY: 3,
    PASSWORD_CHANGE_DAILY_LIMIT: parsePositiveInt(process.env.AUTH_PASSWORD_CHANGE_DAILY_LIMIT, 3),
    PASSWORD_RESET_MAX_EMAILS_PER_HOUR: parsePositiveInt(process.env.AUTH_PASSWORD_RESET_MAX_EMAILS_PER_HOUR, 3),
    PASSWORD_RESET_MAX_REQUESTS_PER_IP_PER_HOUR: parsePositiveInt(process.env.AUTH_PASSWORD_RESET_MAX_REQUESTS_PER_IP_PER_HOUR, 10),
    PASSWORD_RESET_MAX_VERIFY_ATTEMPTS: parsePositiveInt(process.env.AUTH_PASSWORD_RESET_MAX_VERIFY_ATTEMPTS, 5),
    PASSWORD_RESET_RESEND_COOLDOWN_MS: parsePositiveInt(process.env.AUTH_PASSWORD_RESET_RESEND_COOLDOWN_SECONDS, 60) * 1000,
    PASSWORD_CHANGE_ALERT_DELAY_MS: parsePositiveInt(process.env.AUTH_PASSWORD_CHANGE_ALERT_DELAY_MINUTES, 30) * 60 * 1000,
    PASSWORD_CHANGE_ALERT_CRON: (process.env.AUTH_PASSWORD_CHANGE_ALERT_CRON || '*/10 * * * *').trim(),
    PASSWORD_CHANGE_ALERT_BATCH_SIZE: parsePositiveInt(process.env.AUTH_PASSWORD_CHANGE_ALERT_BATCH_SIZE, 100),
    TX_MAX_WAIT_MS: Number.parseInt(process.env.AUTH_TX_MAX_WAIT_MS || '10000', 10),
    TX_TIMEOUT_MS: Number.parseInt(process.env.AUTH_TX_TIMEOUT_MS || '20000', 10),
};

export const UPLOAD_CONFIG = {
    MAX_FILE_SIZE: 10 * 1024 * 1024, // 10MB
};

const subscriptionPriceNaira = parsePositiveInt(process.env.SUBSCRIPTION_PRICE_NAIRA, 5000);
const subscriptionDurationMonths = parsePositiveInt(process.env.SUBSCRIPTION_DURATION_MONTHS, 5);
const configuredSubscriptionProvider = (process.env.SUBSCRIPTION_PAYMENT_PROVIDER || 'PAYSTACK').trim().toUpperCase();

export const SUBSCRIPTION_CONFIG = {
    PAYMENT_PROVIDER: configuredSubscriptionProvider === 'MONNIFY' ? 'MONNIFY' : 'PAYSTACK',
    PLAN_TYPE: process.env.SUBSCRIPTION_PLAN_TYPE || 'PREMIUM_5_MONTH',
    PLAN_NAME: process.env.SUBSCRIPTION_PLAN_NAME || 'StudyBond Premium',
    PRICE_NAIRA: subscriptionPriceNaira,
    PRICE_KOBO: subscriptionPriceNaira * 100,
    DURATION_MONTHS: subscriptionDurationMonths,
    CURRENCY: process.env.SUBSCRIPTION_CURRENCY || 'NGN',
    CALLBACK_URL: process.env.PAYSTACK_CALLBACK_URL?.trim() || undefined,
    PROVIDER_TIMEOUT_MS: parsePositiveInt(process.env.SUBSCRIPTION_PROVIDER_TIMEOUT_MS, 10000),
    INITIATE_RATE_LIMIT_MAX: parsePositiveInt(process.env.SUBSCRIPTION_INITIATE_RATE_LIMIT_MAX, 5),
    VERIFY_RATE_LIMIT_MAX: parsePositiveInt(process.env.SUBSCRIPTION_VERIFY_RATE_LIMIT_MAX, 10),
    CANCEL_RATE_LIMIT_MAX: parsePositiveInt(process.env.SUBSCRIPTION_CANCEL_RATE_LIMIT_MAX, 5),
    EXPIRY_BATCH_SIZE: parsePositiveInt(process.env.SUBSCRIPTION_EXPIRY_BATCH_SIZE, 100)
};

export const EMAIL_CONFIG = {
    FROM_NAME: (process.env.EMAIL_FROM_NAME || 'StudyBond').trim(),
    FROM_ADDRESS: process.env.EMAIL_FROM_ADDRESS?.trim() || '',
    SECURITY_FROM_ADDRESS: process.env.EMAIL_SECURITY_FROM_ADDRESS?.trim() || 'security@mail.studybond.app',
    WELCOME_FROM_ADDRESS: process.env.EMAIL_WELCOME_FROM_ADDRESS?.trim() || 'welcome@mail.studybond.app',
    REMINDERS_FROM_ADDRESS: process.env.EMAIL_REMINDERS_FROM_ADDRESS?.trim() || 'reminders@mail.studybond.app',
    REPLY_TO_ADDRESS: process.env.EMAIL_REPLY_TO_ADDRESS?.trim() || undefined,
    PROVIDER_TIMEOUT_MS: parsePositiveInt(process.env.EMAIL_PROVIDER_TIMEOUT_MS, 10000),
    BREVO_API_KEY: process.env.BREVO_API_KEY?.trim() || '',
    BREVO_BASE_URL: process.env.BREVO_BASE_URL?.trim() || 'https://api.brevo.com/v3/smtp/email',
    RESEND_API_KEY: process.env.RESEND_API_KEY?.trim() || '',
    RESEND_BASE_URL: process.env.RESEND_BASE_URL?.trim() || 'https://api.resend.com/emails'
};

export const MEDIA_CONFIG = {
    CLOUDINARY_CLOUD_NAME: process.env.CLOUDINARY_CLOUD_NAME?.trim() || '',
    CLOUDINARY_API_KEY: process.env.CLOUDINARY_API_KEY?.trim() || '',
    CLOUDINARY_API_SECRET: process.env.CLOUDINARY_API_SECRET?.trim() || '',
    CLOUDINARY_BASE_URL: process.env.CLOUDINARY_BASE_URL?.trim() || 'https://api.cloudinary.com/v1_1',
    CLOUDINARY_UPLOAD_FOLDER: (process.env.CLOUDINARY_UPLOAD_FOLDER || 'studybond').trim(),
    CLOUDINARY_UPLOAD_TIMEOUT_MS: parsePositiveInt(process.env.CLOUDINARY_UPLOAD_TIMEOUT_MS, 15000),
    CLOUDINARY_ENABLED: Boolean(
        process.env.CLOUDINARY_CLOUD_NAME?.trim()
        && process.env.CLOUDINARY_API_KEY?.trim()
        && process.env.CLOUDINARY_API_SECRET?.trim()
    )
};

export const ADMIN_CONFIG = {
    MUTATION_RATE_LIMIT_MAX: parsePositiveInt(process.env.ADMIN_MUTATION_RATE_LIMIT_MAX, 20),
    SENSITIVE_RATE_LIMIT_MAX: parsePositiveInt(process.env.ADMIN_SENSITIVE_RATE_LIMIT_MAX, 10),
    READ_RATE_LIMIT_MAX: parsePositiveInt(process.env.ADMIN_READ_RATE_LIMIT_MAX, 120),
    IDEMPOTENCY_TTL_SECONDS: parsePositiveInt(process.env.ADMIN_IDEMPOTENCY_TTL_SECONDS, 86400),
    PREMIUM_MUTATION_TX_TIMEOUT_MS: parsePositiveInt(process.env.ADMIN_PREMIUM_MUTATION_TX_TIMEOUT_MS, 45000),
    STEP_UP_REQUEST_RATE_LIMIT_MAX: parsePositiveInt(process.env.ADMIN_STEP_UP_REQUEST_RATE_LIMIT_MAX, 6),
    STEP_UP_VERIFY_RATE_LIMIT_MAX: parsePositiveInt(process.env.ADMIN_STEP_UP_VERIFY_RATE_LIMIT_MAX, 12),
    STEP_UP_OTP_EXPIRY_MS: parsePositiveInt(process.env.ADMIN_STEP_UP_OTP_EXPIRY_MS, 10 * 60 * 1000),
    STEP_UP_TOKEN_TTL_MS: parsePositiveInt(process.env.ADMIN_STEP_UP_TOKEN_TTL_MS, 10 * 60 * 1000),
    STEP_UP_MAX_FAILED_ATTEMPTS: parsePositiveInt(process.env.ADMIN_STEP_UP_MAX_FAILED_ATTEMPTS, 5)
};

export const ADMIN_ANALYTICS_CONFIG = {
    ROLLUP_CRON: (process.env.ADMIN_ANALYTICS_ROLLUP_CRON || '*/20 * * * *').trim(),
    ROLLUP_LOOKBACK_DAYS: parsePositiveInt(process.env.ADMIN_ANALYTICS_ROLLUP_LOOKBACK_DAYS, 35),
    USER_360_RECENT_LIMIT: parsePositiveInt(process.env.ADMIN_USER_360_RECENT_LIMIT, 5),
    USER_360_AUDIT_LIMIT: parsePositiveInt(process.env.ADMIN_USER_360_AUDIT_LIMIT, 10)
};

export const BOOKMARK_CONFIG = {
    EXPIRY_CLEANUP_CRON: (process.env.BOOKMARK_EXPIRY_CLEANUP_CRON || '*/30 * * * *').trim(),
    EXPIRY_CLEANUP_BATCH_SIZE: parsePositiveInt(process.env.BOOKMARK_EXPIRY_CLEANUP_BATCH_SIZE, 500),
    EXPIRY_CLEANUP_MAX_BATCHES: parsePositiveInt(process.env.BOOKMARK_EXPIRY_CLEANUP_MAX_BATCHES, 20)
};

export const INSTITUTION_CONFIG = {
    LAUNCH_INSTITUTION_CODE: (process.env.LAUNCH_INSTITUTION_CODE || 'UI').trim().toUpperCase()
};

export const STREAK_CONFIG = {
    REMINDER_CRON: (process.env.STREAK_REMINDER_CRON || '0 21 * * *').trim(),
    REMINDER_BATCH_SIZE: parsePositiveInt(process.env.STREAK_REMINDER_BATCH_SIZE, 100),
    RECONCILIATION_CRON: (process.env.STREAK_RECONCILIATION_CRON || '5 * * * *').trim(),
    RECONCILIATION_BATCH_SIZE: parsePositiveInt(process.env.STREAK_RECONCILIATION_BATCH_SIZE, 500),
    RECONCILIATION_MAX_BATCHES: parsePositiveInt(process.env.STREAK_RECONCILIATION_MAX_BATCHES, 20),
    CALENDAR_DEFAULT_DAYS: parsePositiveInt(process.env.STREAK_CALENDAR_DEFAULT_DAYS, 30),
    CALENDAR_MAX_DAYS: parsePositiveInt(process.env.STREAK_CALENDAR_MAX_DAYS, 90),
    FREE_PROMPT_COOLDOWN_DAYS: parsePositiveInt(process.env.STREAK_FREE_PROMPT_COOLDOWN_DAYS, 7)
};

export function getDevToolsConfig() {
    return {
        OTP_PREVIEW_ENABLED: parseBoolean(process.env.DEV_OTP_PREVIEW_ENABLED, false),
        TOKEN: (process.env.DEV_TOOLS_TOKEN || '').trim(),
        OTP_PREVIEW_TTL_SECONDS: parsePositiveInt(process.env.DEV_OTP_PREVIEW_TTL_SECONDS, 30 * 60),
        OTP_PREVIEW_LIST_LIMIT_MAX: parsePositiveInt(process.env.DEV_OTP_PREVIEW_LIST_LIMIT_MAX, 20),
        OTP_PREVIEW_SCAN_LIMIT: parsePositiveInt(process.env.DEV_OTP_PREVIEW_SCAN_LIMIT, 200),
        OTP_PREVIEW_REDIS_BATCH_SIZE: parsePositiveInt(process.env.DEV_OTP_PREVIEW_REDIS_BATCH_SIZE, 50)
    };
}
