import { AppError, notFound } from '../../errors/AppError.js';
import { financialPeriodsRepository } from './financialPeriods.repository.js';
import { recordAuditLog } from '../audit/auditLog.service.js';

// Basic open/closed lock only — Phase 8 adds the full closing workflow
// (balance snapshotting, budget-vs-actual freeze). This is the minimum the
// Financial Engine needs to know whether a transaction may post
// (docs/MASTER_TODO.md Phase 3, docs/FINANCIAL_ARCHITECTURE.md §5).
export async function createPeriod(tenantId, { label, startDate, endDate }, connection) {
  return financialPeriodsRepository.create(tenantId, { label, startDate, endDate }, connection);
}

export async function getOpenPeriod(tenantId, connection) {
  return financialPeriodsRepository.findOpen(tenantId, connection);
}

export async function assertPeriodOpenAndOwned(tenantId, financialPeriodId, connection) {
  const period = await financialPeriodsRepository.findById(tenantId, financialPeriodId, connection);
  if (!period) throw notFound('Financial period not found');
  if (period.status !== 'open') {
    throw new AppError('PERIOD_LOCKED', 'This financial period is closed and cannot accept new postings', {
      status: 409,
    });
  }
  return period;
}

export async function closePeriod(tenantId, periodId, userId) {
  const period = await financialPeriodsRepository.close(tenantId, periodId, userId);
  if (!period) throw notFound('Financial period not found');
  await recordAuditLog({
    tenantId,
    actorUserId: userId,
    action: 'financial_period.closed',
    entityType: 'financial_periods',
    entityId: periodId,
  });
  return period;
}

export async function reopenPeriod(tenantId, periodId, userId, reason) {
  const period = await financialPeriodsRepository.reopen(tenantId, periodId);
  if (!period) throw notFound('Financial period not found');
  await recordAuditLog({
    tenantId,
    actorUserId: userId,
    action: 'financial_period.reopened',
    entityType: 'financial_periods',
    entityId: periodId,
    after: { reason },
  });
  return period;
}
