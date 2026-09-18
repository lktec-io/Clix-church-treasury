import { AppError } from '../errors/AppError.js';

// MySQL raises this when a DELETE would orphan a row that still points at the
// one being removed (ON DELETE RESTRICT).
const FK_REFERENCED = 'ER_ROW_IS_REFERENCED_2';

/**
 * Runs a hard delete and turns the database's own refusal into an explained
 * 409 instead of a 500.
 *
 * This is the last line of defence, not the first: each service checks the
 * cases it knows about (a member with giving history, a paid expense) and
 * says so in domain language. But the foreign keys know about references the
 * service layer has not thought of — an audit row, a receipt, a future
 * table — and a treasurer clicking "Delete permanently" deserves "this
 * record is still referenced by financial history" rather than a crash.
 *
 * `message` is what the user sees; it should say what to do instead.
 */
export async function hardDelete(message, run) {
  try {
    return await run();
  } catch (error) {
    if (error.code === FK_REFERENCED) {
      throw new AppError('CONFLICT', message, { status: 409 });
    }
    throw error;
  }
}

/** Refuses the delete outright, in the same shape as the guard above. */
export function refuseDelete(message) {
  throw new AppError('CONFLICT', message, { status: 409 });
}
