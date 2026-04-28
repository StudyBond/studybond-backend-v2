import { AppError } from './AppError';

export class NotFoundError extends AppError {
  constructor(message = 'The requested resource was not found.', details?: unknown) {
    super(message, 404, 'NOT_FOUND', details);
    Object.setPrototypeOf(this, NotFoundError.prototype);
  }
}
