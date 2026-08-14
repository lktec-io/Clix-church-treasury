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
import { formatMoney } from '../utils/format.js';

const PAYMENT_METHODS = ['cash', 'bank', 'mobile_money', 'cheque', 'other'];
const PAGE_SIZE = 50;
const STATUS_BADGE = {
  draft: 'badge--neutral',
  submitted: 'badge--warning',
  approved: 'badge--success',
  rejected: 'badge--danger',
  paid: 'badge--success',
};

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
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [expenseData, accountData, fundData, categoryData] = await Promise.all([
        expensesApi.list({ limit: PAGE_SIZE }),
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
  }, []);

  const loadMore = async () => {
    setLoadingMore(true);
    try {
      const nextPage = await expensesApi.list({ limit: PAGE_SIZE, offset: expenses.length });
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

  const isOwnRequest = (expense) => expense.requested_by_user_id === session?.user?.id;

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

      <div className="card">
        <div className="card__header">
          <h2>{t('expenses.title')}</h2>
        </div>
        {loading ? (
          <div className="empty-state">{t('common.loading')}</div>
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
                      {expense.status === 'submitted' && !isOwnRequest(expense) && (
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
                      {expense.status === 'submitted' && (
                        <PermissionGate permission="expense.reject">
                          <button type="button" className="btn btn--danger btn--sm" onClick={() => handleReject(expense)}>
                            {t('expenses.reject')}
                          </button>
                        </PermissionGate>
                      )}
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
