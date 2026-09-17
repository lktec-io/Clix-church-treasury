import { formatDate, formatTime } from '../../utils/format.js';

/**
 * A server timestamp as local date over local hour:minute. Both lines come
 * from the same UTC value, so an entry made at 22:30 UTC shows the next
 * Tanzanian calendar day with its correct 01:30 time.
 */
export default function RecordedStamp({ value }) {
  if (!value) return <span className="cell-muted">—</span>;
  return (
    <span className="ledger-stamp">
      <span className="ledger-stamp__date">{formatDate(value)}</span>
      <span className="ledger-stamp__time">{formatTime(value)}</span>
    </span>
  );
}
