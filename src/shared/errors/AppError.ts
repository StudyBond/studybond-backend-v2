export class AppError extends Error {
  public readonly statusCode: number;
  public readonly isOperational: boolean;

  constructor(message: string, statusCode: number = 400) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = true;

    // Capturing stack trace helps with debugging
    Error.captureStackTrace(this, this.constructor);
  }
}