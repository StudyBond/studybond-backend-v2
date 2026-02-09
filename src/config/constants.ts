
export const AUTH_CONFIG = {
    JWT_EXPIRY: process.env.JWT_EXPIRY || '15m',
    REFRESH_TOKEN_EXPIRY: process.env.REFRESH_TOKEN_EXPIRY || '30d',
    SALT_ROUNDS: 10,
    OTP_EXPIRY_MS: 15 * 60 * 1000, // 15 minutes
    SESSION_EXPIRY_MS: 30 * 24 * 60 * 60 * 1000, // 30 days
    MAX_DEVICES: 2,
    MAX_OTP_REQUESTS_DAILY: 3,
};

export const UPLOAD_CONFIG = {
    MAX_FILE_SIZE: 10 * 1024 * 1024, // 10MB
};
