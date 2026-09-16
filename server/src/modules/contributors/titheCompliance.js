// Tithe compliance for the member directory. Pure, so it is unit-testable.
//
// DEFINITION — deliberately simple and explainable to a church board, since a
// member will see the result next to their name:
//   current  tithed in the current calendar month
//   due      last tithed in the previous calendar month (not yet this month)
//   lapsed   last tithed before that
//   none     no tithe recorded at all
//
// "Tithe" means a posted contribution to a category whose report_group is
// 'tithe' (migration 0029). A church that has not marked any category as its
// tithe category will see every member as `none` — the UI says so rather than
// implying the whole congregation has stopped giving.
//
// Months are Tanzanian calendar months (EAT, UTC+3), not UTC ones: a tithe
// recorded on the evening of the 31st local time must count for that month.
const EAT_OFFSET_MS = 3 * 60 * 60 * 1000;

function yearMonth(date) {
  return date.getUTCFullYear() * 12 + date.getUTCMonth();
}

export function titheComplianceStatus(lastTitheDate, now = new Date()) {
  if (!lastTitheDate) return 'none';
  const match = /^(\d{4})-(\d{2})/.exec(String(lastTitheDate));
  if (!match) return 'none';

  const lastMonth = Number(match[1]) * 12 + (Number(match[2]) - 1);
  const localNow = new Date(now.getTime() + EAT_OFFSET_MS);
  const currentMonth = yearMonth(localNow);

  if (lastMonth >= currentMonth) return 'current';
  if (lastMonth === currentMonth - 1) return 'due';
  return 'lapsed';
}
