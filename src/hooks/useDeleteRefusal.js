import { useCallback } from 'react';
import { useExplain } from '../components/ConfirmDialog.jsx';
import { useLocale } from '../i18n/LocaleContext.jsx';

// The tables a delete can be refused over, mapped to how a treasurer names
// them. The server sends stable entity keys rather than English phrases
// precisely so this list can be translated; the foreign-key backstop can
// also report a table this map has never heard of, which falls back to the
// table's own name rather than showing nothing.
const BLOCKER_LABEL_KEYS = {
  contributions: 'delete.blocker.contributions',
  pledges: 'delete.blocker.pledges',
  transactions: 'delete.blocker.transactions',
  expenses: 'delete.blocker.expenses',
  audit_logs: 'delete.blocker.auditLogs',
  journal_entries: 'delete.blocker.journalEntries',
  journal_lines: 'delete.blocker.journalEntries',
  receipts: 'delete.blocker.receipts',
};

/**
 * Turns a refused delete into the explain-box, and anything else into
 * `false` so the caller can handle it as it always did.
 *
 *   } catch (err) {
 *     if (explainRefusal(err, name)) return;
 *     setError(unwrapApiError(err).message);
 *   }
 *
 * Only a 409 is treated this way. A 500, a dropped connection or a
 * permission error are different problems with different fixes, and
 * dressing them up as "this record is in use" would be a lie.
 */
export function useDeleteRefusal() {
  const explain = useExplain();
  const { t } = useLocale();

  return useCallback(
    (error, subject) => {
      const refused = error?.code === 'CONFLICT' || error?.status === 409;
      if (!refused) return false;

      const blockers = (error?.details?.blockers ?? []).map((item) => ({
        label: BLOCKER_LABEL_KEYS[item.entity] ? t(BLOCKER_LABEL_KEYS[item.entity]) : item.entity,
        count: item.count,
      }));

      explain({
        title: t('delete.blocked.title'),
        message: subject ? `${subject} — ${error.message}` : error.message,
        blockers,
        // Stated whenever we know it: nothing was deleted, which is the
        // first thing anyone wants to know after a failed destructive click.
        hint: t('delete.blocked.hint'),
      });
      return true;
    },
    [explain, t]
  );
}
