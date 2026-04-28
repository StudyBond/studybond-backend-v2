export class EmailProviderError extends Error {
  public readonly statusCode?: number;
  public readonly code: string;
  public readonly retryable: boolean;

  constructor(
    message: string,
    options: {
      statusCode?: number;
      code?: string;
      retryable?: boolean;
    } = {}
  ) {
    super(message);
    this.statusCode = options.statusCode;
    this.code = options.code || 'EMAIL_PROVIDER_ERROR';
    this.retryable = options.retryable ?? true;
    Error.captureStackTrace(this, this.constructor);
  }
}
