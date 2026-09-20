// Matches the error envelope in docs/API_ARCHITECTURE.md §4.
export class AppError extends Error {
  /**
   * `details` — structured, machine-readable context the UI can render as
   * something better than a sentence. Currently used by refused deletes to
   * name the records that still reference the row (`blockers`), so the app
   * can show "12 contributions, 1 pledge" instead of "cannot be deleted".
   * It never carries anything the caller is not already allowed to see.
   */
  constructor(code, message, { status = 400, fields = undefined, details = undefined } = {}) {
    super(message);
    this.code = code;
    this.status = status;
    this.fields = fields;
    this.details = details;
  }
}

export const notFound = (message = 'Resource not found') =>
  new AppError('NOT_FOUND', message, { status: 404 });

export const forbidden = (message = 'Not permitted') =>
  new AppError('FORBIDDEN', message, { status: 403 });

export const unauthenticated = (message = 'Authentication required') =>
  new AppError('UNAUTHENTICATED', message, { status: 401 });

export const validationError = (message, fields) =>
  new AppError('VALIDATION_ERROR', message, { status: 422, fields });

export const conflict = (message) => new AppError('CONFLICT', message, { status: 409 });
