export class AuthError extends Error {
    public statusCode: number;
    public code: string;

    constructor(message: string, statusCode = 401, code = 'AUTH_ERROR') {
        super(message);
        this.statusCode = statusCode;
        this.code = code;
        Object.setPrototypeOf(this, AuthError.prototype);
    }
}
