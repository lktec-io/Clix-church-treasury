import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { expensesApi, accountsApi, fundsApi, categoriesApi } from '../api/endpoints.js';
import { unwrapApiError } from '../api/client.js';
import { useLocale } from '../i18n/LocaleContext.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../components/Toast.jsx';
import { useConfirm } from '../components/ConfirmDialog.jsx';
import PermissionGate from '../components/PermissionGate.jsx';
import PageHeader from '../components/ui/PageHeader.jsx';
import { SkeletonTable } from '../components/ui/Skeleton.jsx';
import { formatMoney, sanitizeAmountInput } from '../utils/format.js';

const PAYMENT_METHODS = ['cash', 'bank', 'mobile_money', 'cheque', 'other'];
const PAGE_SIZE = 50;
const STATUS_BADGE = {
  draft: 'badge--neutral',
  submitted: 'badge--warning',
  approved: 'badge--success',
  rejected: 'badge--danger',
  paid: 'badge--success',
};
// Same set the server validates against (expenses.controller.js) — an option
// this list offers that the API rejects would be a dead filter.
const STATUSES = ['draft', 'submitted', 'approved', 'rejected', 'paid'];

function emptyForm() {
  return { amount: '', categoryId: '', fundId: '', accountId: '', payee: '', description: '', paymentMethod: 'bank', reference: '' };
}

export default function ExpensesPage() {
  const { t } = useLocale();
  const { session, hasPermission } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const [expenses, setExpenses] = useState([]);
  const [pending, setPending] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [funds, setFunds] = useState([]);
  const [categories, setCategories] = useState([]);
  const [form, setForm] = useState(emptyForm());
  const [statusFilter, setStatusFilter] = useState('');
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);

  // Whether to render the approvals queue at all. Checked here rather than
  // relying only on <PermissionGate> around the markup so the extra
  // status=submitted request is never even fired by a clerk who could not
  // action its contents — the API would answer it fine (expense.view covers
  // the read), but it would be a wasted round-trip on every page load.
  const canApprove = hasPermission('expense.approve');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [expenseData, pendingData, accountData, fundData, categoryData] = await Promise.all([
        expensesApi.list({ limit: PAGE_SIZE, ...(statusFilter ? { status: statusFilter } : {}) }),
        // Fetched separately rather than filtered out of `expenseData`: the
        // main list is paginated, so a submitted expense sitting past the
        // first 50 rows would silently never appear in the queue.
        canApprove ? expensesApi.list({ status: 'submitted', limit: PAGE_SIZE }) : Promise.resolve([]),
        accountsApi.list(),
        fundsApi.list(),
        categoriesApi.list('expense'),
      ]);
      setExpenses(expenseData);
      setPending(pendingData);
      setHasMore(expenseData.length === PAGE_SIZE);
      setAccounts(accountData);
      setFunds(fundData);
      setCategories(categoryData);
    } catch (err) {
      setError(unwrapApiError(err).message);
    } finally {
      setLoading(false);
    }
  }, [statusFilter, canApprove]);

  const loadMore = async () => {
    setLoadingMore(true);
    try {
      const nextPage = await expensesApi.list({
        limit: PAGE_SIZE,
        offset: expenses.length,
        ...(statusFilter ? { status: statusFilter } : {}),
      });
      setExpenses((rows) => [...rows, ...nextPage]);
      setHasMore(nextPage.length === PAGE_SIZE);
    } catch (err) {
      setError(unwrapApiError(err).message);
    } finally {
      setLoadingMore(false);
    }
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  const handleChange = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await expensesApi.create({
        ...form,
        amount: sanitizeAmountInput(form.amount),
        categoryId: Number(form.categoryId),
        fundId: Number(form.fundId),
        accountId: Number(form.accountId),
      });
      setForm(emptyForm());
      await load();
      toast.success(t('expenses.requested'));
    } catch (err) {
      setError(unwrapApiError(err).message);
    } finally {
      setSubmitting(false);
    }
  };

  const runAction = async (action, successMessage) => {
    setError(null);
    try {
      await action();
      await load();
      if (successMessage) toast.success(successMessage);
    } catch (err) {
      setError(unwrapApiError(err).message);
    }
  };

  const handleReject = async (expense) => {
    const result = await confirm({
      title: t('expenses.reject'),
      message: t('expenses.rejectConfirm'),
      tone: 'danger',
      confirmLabel: t('expenses.reject'),
      requireReason: true,
    });
    if (!result.confirmed) return;
    await runAction(() => expensesApi.reject(expense.id, result.reason), t('expenses.rejectedToast'));
  };

  // The softer half of "not approving this": sends the request back to draft
  // so the requester can correct and resubmit, instead of killing it. The
  // endpoint has existed since Phase 5 but had no control on this screen, so
  // an approver's only option for a fixable typo was outright rejection.
  const handleReturn = async (expense) => {
    const result = await confirm({
      title: t('expenses.returnForCorrection'),
      message: t('expenses.returnConfirm'),
      confirmLabel: t('expenses.returnForCorrection'),
      requireReason: true,
    });
    if (!result.confirmed) return;
    await runAction(() => expensesApi.returnForCorrection(expense.id, result.reason), t('expenses.returnedToast'));
  };

  const isOwnRequest = (expense) => expense.requested_by_user_id === session?.user?.id;

  // Approve / Reject / Return, shared by the approvals queue and the main
  // list so the two can never drift apart on what an approver is offered.
  //
  // Every button here is additionally enforced server-side — the routes are
  // behind requirePermission('expense.approve' / 'expense.reject'), and
  // approveExpense() independently re-checks that the approver is not the
  // requester. <PermissionGate> and the isOwnRequest() check below only
  // decide what is worth *showing*; neither is the control.
  const approvalActions = (expense) => (
    <>
      {/* Segregation of duties: an approver cannot approve their own
          request, so the button is not offered on it. Reject/Return stay
          available — withdrawing your own request is legitimate. */}
      {!isOwnRequest(expense) && (
        <PermissionGate permission="expense.approve">
          <button
            type="button"
            className="btn btn--primary btn--sm"
            onClick={() => runAction(() => expensesApi.approve(expense.id), t('expenses.approvedToast'))}
          >
            {t('expenses.approve')}
          </button>
        </PermissionGate>
      )}
      <PermissionGate permission="expense.reject">
        <button type="button" className="btn btn--secondary btn--sm" onClick={() => handleReturn(expense)}>
          {t('expenses.returnForCorrection')}
        </button>
        <button type="button" className="btn btn--danger btn--sm" onClick={() => handleReject(expense)}>
          {t('expenses.reject')}
        </button>
      </PermissionGate>
    </>
  );

  return (
    <div>
      <PageHeader title={t('expenses.title')} />
      {error && <div className="alert alert--error">{error}</div>}

      <PermissionGate permission="expense.create">
        <div className="card">
          <div className="card__header">
            <h2>{t('expenses.requestNew')}</h2>
          </div>
          <form onSubmit={handleSubmit}>
            <div className="form-grid">
              <div className="field">
                <label>{t('common.amount')}</label>
                <input type="text" inputMode="decimal" placeholder="0.00" value={form.amount} onChange={handleChange('amount')} required />
              </div>
              <div className="field">
                <label>{t('expenses.payee')}</label>
                <input value={form.payee} onChange={handleChange('payee')} required />
              </div>
              <div className="field">
                <label>{t('contributions.account')}</label>
                <select value={form.accountId} onChange={handleChange('accountId')} required>
                  <option value="" disabled>—</option>
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>{a.name}</option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label>{t('contributions.fund')}</label>
                <select value={form.fundId} onChange={handleChange('fundId')} required>
                  <option value="" disabled>—</option>
                  {funds.map((f) => (
                    <option key={f.id} value={f.id}>{f.name}</option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label>{t('contributions.category')}</label>
                <select value={form.categoryId} onChange={handleChange('categoryId')} required>
                  <option value="" disabled>—</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
                {categories.length === 0 && (
                  <span className="field-error">
                    {t('categories.emptyHint')} <Link to="/categories">{t('categories.title')}</Link>
                  </span>
                )}
              </div>
              <div className="field">
                <label>{t('contributions.paymentMethod')}</label>
                <select value={form.paymentMethod} onChange={handleChange('paymentMethod')} required>
                  {PAYMENT_METHODS.map((m) => (
                    <option key={m} value={m}>{t(`paymentMethod.${m}`)}</option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label>{t('common.reference')}</label>
                <input value={form.reference} onChange={handleChange('reference')} />
              </div>
              <div className="field field--full">
                <label>{t('expenses.description')}</label>
                <textarea rows={2} value={form.description} onChange={handleChange('description')} />
              </div>
            </div>
            <div className="form-actions">
              <button type="submit" className="btn btn--primary" disabled={submitting}>
                {submitting ? t('common.loading') : t('common.record')}
              </button>
            </div>
          </form>
        </div>
      </PermissionGate>

      {/* THE TREASURY GATE.
          Every submitted expense waiting on a decision, in one place, ahead
          of the general list — an approver should not have to hunt through
          paid history to find what needs them.

          Worth being explicit about what this screen does and does not do:
          no expense reduces a fund or account balance at any point in this
          card. The ledger is touched exactly once, at "Mark paid"
          (expenses.service.js#payExpense), which requires status 'approved'
          and posts through the shared financial engine inside one DB
          transaction. Draft, submitted, approved and rejected expenses have
          zero balance effect — approval is a separate gate BEFORE payment,
          not the payment itself. */}
      <PermissionGate permission="expense.approve">
        <div className="card">
          <div className="card__header">
            <h2>
              {t('expenses.pendingApprovals')}
              {pending.length > 0 && <span className="badge badge--warning" style={{ marginLeft: 8 }}>{pending.length}</span>}
            </h2>
          </div>
          <p className="field-hint" style={{ margin: '0 0 14px' }}>{t('expenses.pendingHint')}</p>
          {loading ? (
            <SkeletonTable rows={2} columns={4} />
          ) : pending.length === 0 ? (
            <div className="empty-state">{t('expenses.noPending')}</div>
          ) : (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>{t('expenses.payee')}</th>
                    <th>{t('common.amount')}</th>
                    <th>{t('common.reference')}</th>
                    <th>{t('common.actions')}</th>
                  </tr>
                </thead>
                <tbody>
                  {pending.map((expense) => (
                    <tr key={expense.id}>
                      <td>{expense.payee}</td>
                      <td className="tabular-nums">{formatMoney(expense.amount)}</td>
                      <td>{expense.expense_number}</td>
                      <td style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>{approvalActions(expense)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </PermissionGate>

      <div className="card">
        <div className="card__header">
          <h2>{t('expenses.title')}</h2>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            aria-label={t('expenses.filterStatus')}
            style={{ maxWidth: 180 }}
          >
            <option value="">{t('expenses.allStatuses')}</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>{t(`expenses.status.${s}`)}</option>
            ))}
          </select>
        </div>
        {loading ? (
          <SkeletonTable rows={4} columns={4} />
        ) : expenses.length === 0 ? (
          <div className="empty-state">{t('common.noResults')}</div>
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>{t('expenses.payee')}</th>
                  <th>{t('common.amount')}</th>
                  <th>{t('common.status')}</th>
                  <th>{t('common.actions')}</th>
                </tr>
              </thead>
              <tbody>
                {expenses.map((expense) => (
                  <tr key={expense.id}>
                    <td>{expense.payee}</td>
                    <td>{formatMoney(expense.amount)}</td>
                    <td>
                      <span className={`badge ${STATUS_BADGE[expense.status]}`}>
                        {t(`expenses.status.${expense.status}`)}
                      </span>
                    </td>
                    <td style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      {expense.status === 'draft' && isOwnRequest(expense) && (
                        <PermissionGate permission="expense.submit">
                          <button
                            type="button"
                            className="btn btn--secondary btn--sm"
                            onClick={() => runAction(() => expensesApi.submit(expense.id), t('expenses.submittedToast'))}
                          >
                            {t('expenses.submit')}
                          </button>
                        </PermissionGate>
                      )}
                      {expense.status === 'submitted' && approvalActions(expense)}
                      {expense.status === 'approved' && (
                        <PermissionGate permission="expense.pay">
                          <button
                            type="button"
                            className="btn btn--primary btn--sm"
                            onClick={() => runAction(() => expensesApi.pay(expense.id), t('expenses.paidToast'))}
                          >
                            {t('expenses.pay')}
                          </button>
                        </PermissionGate>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {hasMore && (
          <div style={{ textAlign: 'center', marginTop: 14 }}>
            <button type="button" className="btn btn--secondary btn--sm" onClick={loadMore} disabled={loadingMore}>
              {loadingMore ? t('common.loading') : t('common.loadMore')}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
