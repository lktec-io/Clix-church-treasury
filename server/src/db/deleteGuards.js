import { AppError } from '../errors/AppError.js';

// MySQL raises this when a DELETE would orphan a row that still points at the
// one being removed (ON DELETE RESTRICT).
const FK_REFERENCED = 'ER_ROW_IS_REFERENCED_2';

// MySQL names the CHILD table and the constraint in its error text:
//
//   Cannot delete or update a parent row: a foreign key constraint fails
//   (`clix`.`transactions`, CONSTRAINT `fk_transactions_created_by`
//    FOREIGN KEY (`created_by_user_id`) REFERENCES `users` (`id`))
//
// That is the precise audit trail holding the row — far more use to a
// treasurer than "cannot be deleted" — so it is parsed out rather than
// discarded. Parsing is best-effort by design: the wording varies between
// MySQL and MariaDB versions, and a miss simply means the generic message
// stands alone.
const FK_DETAIL = /`(?:[^`]+)`\.`([^`]+)`,\s*CONSTRAINT\s+`([^`]+)`(?:\s+FOREIGN KEY\s+\(`([^`]+)`\))?/i;

export function parseForeignKeyReference(error) {
  const match = FK_DETAIL.exec(error?.sqlMessage ?? error?.message ?? '');
  if (!match) return null;
  return { table: match[1], constraint: match[2], column: match[3] ?? null };
}

/**
 * A blocker describes one kind of record standing in the way of a delete, in
 * a shape the UI can list: `{ entity, count }`.
 *
 * `entity` is a stable key the client translates ('contributions',
 * 'pledges', …) rather than an English phrase — the app is bilingual, and a
 * sentence assembled on the server can only be in one language. `count` is
 * omitted when the number is not known (the foreign-key backstop learns
 * WHICH table objected, never how many rows).
 */
export function blocker(entity, count) {
  return count === undefined || count === null ? { entity } : { entity, count: Number(count) };
}

/**
 * Runs a hard delete and turns the database's own refusal into an explained
 * 409 instead of a 500.
 *
 * This is the last line of defence, not the first: each service checks the
 * cases it knows about (a member with giving history, a paid expense) and
 * says so in domain language, with counts. But the foreign keys know about
 * references the service layer has not thought of — an audit row, a receipt,
 * a future table — and a treasurer clicking "Delete permanently" deserves
 * "this record is still referenced by financial history" rather than a crash.
 *
 * `message` is what the user sees; it should say what to do instead.
 */
export async function hardDelete(message, run) {
  try {
    return await run();
  } catch (error) {
    if (error.code === FK_REFERENCED) {
      const reference = parseForeignKeyReference(error);
      // Logged in full server-side: the constraint name is the fastest route
      // to the cause, and it must not be the client's only copy.
      console.warn(
        `[delete] refused by foreign key${reference ? ` ${reference.constraint} (${reference.table}.${reference.column ?? '?'})` : ''}: ${error.sqlMessage ?? error.message}`
      );
      throw new AppError('CONFLICT', message, {
        status: 409,
        details: {
          reason: 'referenced',
          blockers: reference ? [blocker(reference.table)] : [],
          ...(reference ? { constraint: reference.constraint, column: reference.column } : {}),
        },
      });
    }
    throw error;
  }
}

/**
 * Refuses the delete outright, in the same shape as the guard above.
 *
 * `blockers` is what the service already counted — the specific records it
 * checked for before going near the database.
 */
export function refuseDelete(message, blockers = []) {
  throw new AppError('CONFLICT', message, {
    status: 409,
    details: { reason: 'referenced', blockers },
  });
}
