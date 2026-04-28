import { AppError } from './AppError';

export class AuthError extends AppError {
    constructor(message: string, statusCode = 401, code = 'AUTH_ERROR', details?: unknown) {
        super(message, statusCode, code, details);
        Object.setPrototypeOf(this, AuthError.prototype);
    }
}
