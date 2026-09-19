import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { FiCheckSquare, FiTrash2 } from 'react-icons/fi';
import { expensesApi, accountsApi, fundsApi, categoriesApi } from '../api/endpoints.js';
import { unwrapApiError } from '../api/client.js';
import { useLocale } from '../i18n/LocaleContext.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../components/Toast.jsx';
import { useConfirm } from '../components/ConfirmDialog.jsx';
import PermissionGate from '../components/PermissionGate.jsx';
import PageHeader from '../components/ui/PageHeader.jsx';
import { SkeletonTable } from '../components/ui/Skeleton.jsx';
import Dropdown from '../components/ui/Dropdown.jsx';
import RecordedStamp from '../components/ui/RecordedStamp.jsx';
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
  const { session } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const [expenses, setExpenses] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [funds, setFunds] = useState([]);
  const [categories, setCategories] = useState([]);
  const [form, setForm] = useState(emptyForm());
  const [statusFilter, setStatusFilter] = useState('');
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [fieldErrors, setFieldErrors] = useState({});
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [expenseData, accountData, fundData, categoryData] = await Promise.all([
        expensesApi.list({ limit: PAGE_SIZE, ...(statusFilter ? { status: statusFilter } : {}) }),
        accountsApi.list(),
        fundsApi.list(),
        categoriesApi.list('expense'),
      ]);
      setExpenses(expenseData);
      setHasMore(expenseData.length === PAGE_SIZE);
      setAccounts(accountData);
      setFunds(fundData);
      setCategories(categoryData);
    } catch (err) {
      setError(unwrapApiError(err).message);
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

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

  const setField = (field) => (value) => {
    setForm((f) => ({ ...f, [field]: value }));
    setFieldErrors((errors) => ({ ...errors, [field]: undefined }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    // The dropdowns are not native <select required>, so each missing
    // choice is reported on its own control before anything is sent.
    const errors = {};
    if (!form.accountId) errors.accountId = t('common.required');
    if (!form.fundId) errors.fundId = t('common.required');
    if (!form.categoryId) errors.categoryId = t('common.required');
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;
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
      setFieldErrors({});
      await load();
      toast.success(t('expenses.requested'));
    } catch (err) {
      setError(unwrapApiError(err).message);
    } finally {
      setSubmitting(false);
    }
  };

  // Permanent removal of an unpaid request. A paid expense sits in the
  // ledger and the server refuses (409) — reversal is the correction for
  // money that has already moved.
  const handleHardDelete = async (expense) => {
    const ok = await confirm({
      title: t('common.deletePermanently'),
      message: `${t('common.deleteConfirm')} — ${expense.payee} ${formatMoney(expense.amount)}`,
      tone: 'danger',
      confirmLabel: t('common.deletePermanently'),
    });
    if (!ok) return;
    setError(null);
    try {
      await expensesApi.remove(expense.id);
      await load();
      toast.success(t('expenses.deletedToast'));
    } catch (err) {
      setError(unwrapApiError(err).message);
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

  const isOwnRequest = (expense) => expense.requested_by_user_id === session?.user?.id;

  return (
    <div className="page">
      <PageHeader title={t('expenses.title')} subtitle={t('expenses.subtitle')} />
      {error && <div className="alert alert--error">{error}</div>}

      <PermissionGate permission="expense.create">
        <div className="card form-card">
          <div className="card__header">
            <h2>{t('expenses.requestNew')}</h2>
          </div>
          <form onSubmit={handleSubmit}>
            <div className="form-grid">
              <div className="field">
                <label htmlFor="expense-amount">{t('common.amount')}</label>
                <div className="currency-input">
                  <span className="currency-input__prefix">TZS</span>
                  <input
                    id="expense-amount"
                    type="text"
                    inputMode="decimal"
                    autoComplete="off"
                    placeholder="0.00"
                    value={form.amount}
                    onChange={handleChange('amount')}
                    required
                  />
                </div>
              </div>
              <div className="field">
                <label htmlFor="expense-payee">{t('expenses.payee')}</label>
                <input id="expense-payee" value={form.payee} onChange={handleChange('payee')} required />
              </div>
              <div className="field">
                <Dropdown
                  id="expense-account"
                  label={t('contributions.account')}
                  options={accounts.map((a) => ({ value: String(a.id), label: a.name }))}
                  value={form.accountId}
                  onChange={setField('accountId')}
                  invalid={Boolean(fieldErrors.accountId)}
                  errorId="expense-account-error"
                />
                {fieldErrors.accountId && (
                  <span className="field-error" id="expense-account-error">{fieldErrors.accountId}</span>
                )}
              </div>
              <div className="field">
                <Dropdown
                  id="expense-fund"
                  label={t('contributions.fund')}
                  options={funds.map((f) => ({ value: String(f.id), label: f.name }))}
                  value={form.fundId}
                  onChange={setField('fundId')}
                  invalid={Boolean(fieldErrors.fundId)}
                  errorId="expense-fund-error"
                />
                {fieldErrors.fundId && <span className="field-error" id="expense-fund-error">{fieldErrors.fundId}</span>}
              </div>
              <div className="field">
                <Dropdown
                  id="expense-category"
                  label={t('contributions.category')}
                  options={categories.map((c) => ({ value: String(c.id), label: c.name }))}
                  value={form.categoryId}
                  onChange={setField('categoryId')}
                  invalid={Boolean(fieldErrors.categoryId)}
                  errorId="expense-category-error"
                />
                {fieldErrors.categoryId && (
                  <span className="field-error" id="expense-category-error">{fieldErrors.categoryId}</span>
                )}
                {categories.length === 0 && (
                  <span className="field-error">
                    {t('categories.emptyHint')} <Link to="/categories">{t('categories.title')}</Link>
                  </span>
                )}
              </div>
              <div className="field">
                <Dropdown
                  id="expense-method"
                  label={t('contributions.paymentMethod')}
                  options={PAYMENT_METHODS.map((m) => ({ value: m, label: t(`paymentMethod.${m}`) }))}
                  value={form.paymentMethod}
                  onChange={setField('paymentMethod')}
                />
              </div>
              <div className="field">
                <label htmlFor="expense-reference">{t('common.reference')}</label>
                <input id="expense-reference" value={form.reference} onChange={handleChange('reference')} />
              </div>
              <div className="field field--full">
                <label htmlFor="expense-description">{t('expenses.description')}</label>
                <textarea id="expense-description" rows={2} value={form.description} onChange={handleChange('description')} />
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

      <div className="card ledger-card">
        <div className="ledger-toolbar">
          <div className="ledger-toolbar__title">
            <h2>{t('expenses.ledger.title')}</h2>
            {!loading && (
              <span className="ledger-toolbar__count tabular-nums">{t('expenses.ledger.count', { count: expenses.length })}</span>
            )}
          </div>
          <div className="ledger-toolbar__filter">
            <Dropdown
              id="expense-status-filter"
              options={[
                { value: '', label: t('expenses.allStatuses') },
                ...STATUSES.map((status) => ({ value: status, label: t(`expenses.status.${status}`) })),
              ]}
              value={statusFilter}
              onChange={setStatusFilter}
              placeholder={t('expenses.allStatuses')}
              ariaLabel={t('expenses.filterStatus')}
            />
          </div>
        </div>
        {loading ? (
          <SkeletonTable rows={4} columns={6} />
        ) : expenses.length === 0 ? (
          <div className="empty-state">{t('common.noResults')}</div>
        ) : (
          <div className="table-wrap">
            <table className="data-table data-table--dense">
              <thead>
                <tr>
                  <th>{t('expenses.recordedAt')}</th>
                  <th>{t('expenses.voucher')}</th>
                  <th>{t('expenses.payee')}</th>
                  <th className="is-amount">{t('expenses.outflow')}</th>
                  <th>{t('common.status')}</th>
                  <th className="col-actions">{t('common.actions')}</th>
                </tr>
              </thead>
              <tbody>
                {expenses.map((expense) => (
                  <tr key={expense.id}>
                    <td>
                      <RecordedStamp value={expense.created_at} />
                    </td>
                    <td className="is-ref">{expense.expense_number ?? '—'}</td>
                    <td>
                      <span className="cell-stack">
                        <span className="cell-stack__primary">{expense.payee}</span>
                        {expense.description && <span className="cell-stack__secondary">{expense.description}</span>}
                      </span>
                    </td>
                    {/* Only a paid expense has actually left the account; anything
                        earlier is a request, shown muted rather than as money out. */}
                    <td className={`is-amount${expense.status === 'paid' ? ' is-expense' : ' is-pending-amount'}`}>
                      {expense.status === 'paid' ? '− ' : ''}
                      {formatMoney(expense.amount)}
                    </td>
                    <td>
                      <span className={`badge badge--dot ${STATUS_BADGE[expense.status]}`}>
                        {t(`expenses.status.${expense.status}`)}
                      </span>
                    </td>
                    <td className="col-actions">
                      <div className="row-actions">
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
                        {/* Approving and paying happen in one place only, the
                            Approvals Room; the ledger points there instead of
                            repeating the decision buttons. */}
                        {expense.status === 'submitted' && (
                          <PermissionGate permission="expense.approve">
                            <Link to="/treasury/approvals" className="btn btn--ghost btn--sm">
                              <FiCheckSquare aria-hidden="true" /> {t('expenses.reviewInApprovals')}
                            </Link>
                          </PermissionGate>
                        )}
                        {expense.status === 'approved' && (
                          <PermissionGate permission="expense.pay">
                            <Link to="/treasury/approvals" className="btn btn--ghost btn--sm">
                              <FiCheckSquare aria-hidden="true" /> {t('expenses.payInApprovals')}
                            </Link>
                          </PermissionGate>
                        )}
                        {/* Not offered on a paid expense: it is in the ledger
                            and the server refuses to delete it. */}
                        {expense.status !== 'paid' && (
                          <PermissionGate permission="expense.update">
                            <button
                              type="button"
                              className="icon-btn icon-btn--danger"
                              aria-label={t('common.deletePermanently')}
                              title={t('common.deletePermanently')}
                              onClick={() => handleHardDelete(expense)}
                            >
                              <FiTrash2 aria-hidden="true" />
                            </button>
                          </PermissionGate>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {hasMore && (
          <div className="ledger-more">
            <button type="button" className="btn btn--secondary btn--sm" onClick={loadMore} disabled={loadingMore}>
              {loadingMore ? t('common.loading') : t('common.loadMore')}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
