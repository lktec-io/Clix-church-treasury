import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { FiCheck, FiX, FiCornerUpLeft, FiInbox, FiInfo, FiCreditCard } from 'react-icons/fi';
import { expensesApi } from '../api/endpoints.js';
import { unwrapApiError } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useLocale } from '../i18n/LocaleContext.jsx';
import { useActivity } from '../context/ActivityContext.jsx';
import { useToast } from '../components/Toast.jsx';
import { useConfirm } from '../components/ConfirmDialog.jsx';
import PermissionGate from '../components/PermissionGate.jsx';
import { APPROVAL_ROLES } from '../utils/approvalRoles.js';
import PageHeader from '../components/ui/PageHeader.jsx';
import EmptyState from '../components/ui/EmptyState.jsx';
import RecordedStamp from '../components/ui/RecordedStamp.jsx';
import { SkeletonTable } from '../components/ui/Skeleton.jsx';
import { formatMoney } from '../utils/format.js';

// THE APPROVALS ROOM.
//
// Everything waiting on a decision, in one place, in the order the workflow
// runs: requests awaiting approval first, then approved requests awaiting
// payment (the step that actually moves money).
//
// Only expenses appear here, and that is not an omission: income has no
// approval state. A contribution is `posted` the moment it is recorded
// (migration 0019's status ENUM is posted/reversed, and
// contributions.service.js posts the ledger entry inside the same
// transaction), because a church counts money that is already in the tin.
// A collection recorded in error is corrected by reversing it, which is
// what the Collections ledger's Reverse action does. The note at the foot
// of this page says so, rather than leaving a treasurer waiting for
// contributions that will never arrive in this queue.
export default function ApprovalsPage() {
  const { t } = useLocale();
  const { session, hasAnyRole } = useAuth();
  const canDecide = hasAnyRole(APPROVAL_ROLES);
  const toast = useToast();
  const confirm = useConfirm();
  const { recordActivity } = useActivity();
  const [awaitingApproval, setAwaitingApproval] = useState([]);
  const [awaitingPayment, setAwaitingPayment] = useState([]);
  const [busyId, setBusyId] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [submitted, approved] = await Promise.all([
        expensesApi.list({ status: 'submitted' }).catch(() => []),
        expensesApi.list({ status: 'approved' }).catch(() => []),
      ]);
      setAwaitingApproval(submitted);
      setAwaitingPayment(approved);
    } catch (err) {
      setError(unwrapApiError(err).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  // Every action re-reads both queues afterwards: approving moves a row from
  // one list to the other, and paying removes it and changes the balances
  // the dashboard reads.
  const run = async (expense, action, successKey) => {
    setBusyId(expense.id);
    setError(null);
    try {
      await action();
      toast.success(t(successKey));
      recordActivity({ kind: 'expense', message: `${t(successKey)} — ${expense.payee}` });
      await load();
    } catch (err) {
      setError(unwrapApiError(err).message);
    } finally {
      setBusyId(null);
    }
  };

  const handleApprove = (expense) =>
    run(expense, () => expensesApi.approve(expense.id), 'expenses.approvedToast');

  const handleReject = async (expense) => {
    const result = await confirm({
      title: t('expenses.reject'),
      message: t('expenses.rejectConfirm'),
      tone: 'danger',
      confirmLabel: t('expenses.reject'),
      requireReason: true,
    });
    if (!result.confirmed) return;
    await run(expense, () => expensesApi.reject(expense.id, result.reason), 'expenses.rejectedToast');
  };

  const handleReturn = async (expense) => {
    const result = await confirm({
      title: t('expenses.returnForCorrection'),
      message: t('expenses.returnConfirm'),
      confirmLabel: t('expenses.returnForCorrection'),
      requireReason: true,
    });
    if (!result.confirmed) return;
    await run(expense, () => expensesApi.returnForCorrection(expense.id, result.reason), 'expenses.returnedToast');
  };

  // The only action here that moves money: it posts the balanced ledger
  // entry (expenses.service.js#payExpense) and the dashboard balances
  // change with it.
  const handlePay = async (expense) => {
    const ok = await confirm({
      title: t('expenses.pay'),
      message: t('approvals.payConfirm', { payee: expense.payee, amount: formatMoney(expense.amount) }),
      confirmLabel: t('expenses.pay'),
    });
    if (!ok) return;
    await run(expense, () => expensesApi.pay(expense.id), 'expenses.paidToast');
  };

  const renderRow = (expense, stage) => {
    const busy = busyId === expense.id;
    // Segregation of duties: an approver may not approve their own request.
    // The server re-checks this independently; hiding the button only avoids
    // offering a guaranteed 403.
    const isOwn = expense.requested_by_user_id === session?.user?.id;
    return (
      <motion.article
        key={expense.id}
        className={`approval-card approval-card--${stage}`}
        layout
        initial={{ opacity: 0, y: -6 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, height: 0, marginBottom: 0, paddingTop: 0, paddingBottom: 0 }}
        transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
      >
        <div className="approval-card__head">
          <span className="approval-card__payee">{expense.payee}</span>
          <span className="approval-card__amount tabular-nums">TZS {formatMoney(expense.amount)}</span>
        </div>
        <div className="approval-card__meta">
          <span className="is-ref">{expense.expense_number}</span>
          {expense.description && <span className="approval-card__desc">{expense.description}</span>}
          <RecordedStamp value={expense.created_at} />
        </div>
        <div className="approval-card__actions">
          {/* Role gate, outside the permission gates: this church allows only
              an Admin or a Senior Treasurer to decide an expense. Someone
              without one of those roles sees the queue (their .view
              permission earns them that) but no action keys, and is told
              why rather than left wondering where the buttons are. */}
          {!canDecide ? (
            <span className="approval-card__note">{t('approvals.roleRequired')}</span>
          ) : stage === 'approval' ? (
            <>
              {!isOwn && (
                <PermissionGate permission="expense.approve">
                  <button
                    type="button"
                    className="btn btn--approve"
                    disabled={busy}
                    onClick={() => handleApprove(expense)}
                  >
                    <FiCheck aria-hidden="true" /> {busy ? t('common.loading') : t('expenses.approve')}
                  </button>
                </PermissionGate>
              )}
              <PermissionGate permission="expense.reject">
                <button type="button" className="btn btn--reject" disabled={busy} onClick={() => handleReject(expense)}>
                  <FiX aria-hidden="true" /> {t('expenses.reject')}
                </button>
                <button type="button" className="btn btn--ghost btn--sm" disabled={busy} onClick={() => handleReturn(expense)}>
                  <FiCornerUpLeft aria-hidden="true" /> {t('expenses.returnForCorrection')}
                </button>
              </PermissionGate>
              {isOwn && <span className="approval-card__note">{t('approvals.ownRequest')}</span>}
            </>
          ) : (
            <PermissionGate permission="expense.pay">
              <button type="button" className="btn btn--primary" disabled={busy} onClick={() => handlePay(expense)}>
                <FiCreditCard aria-hidden="true" /> {busy ? t('common.loading') : t('expenses.pay')}
              </button>
            </PermissionGate>
          )}
        </div>
      </motion.article>
    );
  };

  return (
    <div className="page">
      <PageHeader title={t('approvals.title')} subtitle={t('approvals.subtitle')} />
      {error && <div className="alert alert--error">{error}</div>}

      <p className="approval-note">
        <FiInfo aria-hidden="true" />
        <span>{t('approvals.stageNote')}</span>
      </p>

      <section className="dash-section">
        <header className="dash-section__head">
          <h2 className="dash-section__title">
            {t('approvals.awaitingApproval')}
            {awaitingApproval.length > 0 && (
              <span className="badge badge--warning tabular-nums">{awaitingApproval.length}</span>
            )}
          </h2>
        </header>
        {loading ? (
          <SkeletonTable rows={2} columns={3} />
        ) : awaitingApproval.length === 0 ? (
          <EmptyState icon={FiInbox} message={t('approvals.noneAwaitingApproval')} />
        ) : (
          <div className="approval-grid">
            <AnimatePresence initial={false}>{awaitingApproval.map((e) => renderRow(e, 'approval'))}</AnimatePresence>
          </div>
        )}
      </section>

      <section className="dash-section">
        <header className="dash-section__head">
          <h2 className="dash-section__title">
            {t('approvals.awaitingPayment')}
            {awaitingPayment.length > 0 && (
              <span className="badge badge--accent tabular-nums">{awaitingPayment.length}</span>
            )}
          </h2>
          <span className="dash-section__hint">{t('approvals.paymentHint')}</span>
        </header>
        {loading ? (
          <SkeletonTable rows={2} columns={3} />
        ) : awaitingPayment.length === 0 ? (
          <EmptyState icon={FiInbox} message={t('approvals.noneAwaitingPayment')} />
        ) : (
          <div className="approval-grid">
            <AnimatePresence initial={false}>{awaitingPayment.map((e) => renderRow(e, 'payment'))}</AnimatePresence>
          </div>
        )}
      </section>

      {/* Why collections are not in this queue. */}
      <p className="ledger-footnote">
        {t('approvals.incomeNote')} <Link to="/contributions">{t('nav.contributions')}</Link>
      </p>
    </div>
  );
}
