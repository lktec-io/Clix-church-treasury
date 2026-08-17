import { useCallback, useEffect, useState } from 'react';
import { budgetsApi, financialPeriodsApi, fundsApi, categoriesApi } from '../api/endpoints.js';
import { unwrapApiError } from '../api/client.js';
import { useLocale } from '../i18n/LocaleContext.jsx';
import { useToast } from '../components/Toast.jsx';
import PermissionGate from '../components/PermissionGate.jsx';
import PageHeader from '../components/ui/PageHeader.jsx';
import { SkeletonTable } from '../components/ui/Skeleton.jsx';
import { formatMoney, sanitizeAmountInput } from '../utils/format.js';

function emptyForm(periodId) {
  return { financialPeriodId: periodId ?? '', fundId: '', categoryId: '', type: 'expense', budgetAmount: '', notes: '' };
}

export default function BudgetsPage() {
  const { t } = useLocale();
  const toast = useToast();
  const [periods, setPeriods] = useState([]);
  const [funds, setFunds] = useState([]);
  const [categories, setCategories] = useState([]);
  const [selectedPeriodId, setSelectedPeriodId] = useState('');
  const [budgets, setBudgets] = useState([]);
  const [form, setForm] = useState(emptyForm());
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [loading, setLoading] = useState(true);

  const loadStatic = useCallback(async () => {
    try {
      const [periodData, fundData] = await Promise.all([financialPeriodsApi.list(), fundsApi.list()]);
      setPeriods(periodData);
      setFunds(fundData);
      const openPeriod = periodData.find((p) => p.status === 'open');
      const initial = openPeriod?.id ?? periodData[0]?.id ?? '';
      setSelectedPeriodId(initial);
      setForm(emptyForm(initial));
    } catch (err) {
      setError(unwrapApiError(err).message);
    }
  }, []);

  const loadCategories = useCallback(async (type) => {
    try {
      setCategories(await categoriesApi.list(type));
    } catch (err) {
      setError(unwrapApiError(err).message);
    }
  }, []);

  const loadBudgets = useCallback(async (periodId) => {
    if (!periodId) {
      setBudgets([]);
      return;
    }
    setLoading(true);
    try {
      setBudgets(await budgetsApi.list({ financialPeriodId: periodId }));
    } catch (err) {
      setError(unwrapApiError(err).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadStatic();
    loadCategories(form.type);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadBudgets(selectedPeriodId);
  }, [selectedPeriodId, loadBudgets]);

  const handleChange = (field) => (e) => {
    const value = e.target.value;
    setForm((f) => ({ ...f, [field]: value }));
    if (field === 'type') loadCategories(value);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await budgetsApi.create({
        ...form,
        budgetAmount: sanitizeAmountInput(form.budgetAmount),
        financialPeriodId: Number(form.financialPeriodId),
        fundId: Number(form.fundId),
        categoryId: form.categoryId ? Number(form.categoryId) : null,
      });
      setForm(emptyForm(selectedPeriodId));
      await loadBudgets(selectedPeriodId);
      toast.success(t('budgets.created'));
    } catch (err) {
      setError(unwrapApiError(err).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div>
      <PageHeader title={t('budgets.title')} />
      {error && <div className="alert alert--error">{error}</div>}

      <div className="card">
        <div className="field" style={{ maxWidth: 280 }}>
          <label>{t('budgets.financialPeriod')}</label>
          <select value={selectedPeriodId} onChange={(e) => setSelectedPeriodId(Number(e.target.value))}>
            {periods.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label} ({t(`financialPeriods.status.${p.status}`)})
              </option>
            ))}
          </select>
        </div>
      </div>

      <PermissionGate permission="budget.manage">
        <div className="card">
          <div className="card__header">
            <h2>{t('budgets.new')}</h2>
          </div>
          <form onSubmit={handleSubmit}>
            <div className="form-grid">
              <div className="field">
                <label>{t('budgets.financialPeriod')}</label>
                <select value={form.financialPeriodId} onChange={handleChange('financialPeriodId')} required>
                  <option value="" disabled>—</option>
                  {periods.map((p) => (
                    <option key={p.id} value={p.id}>{p.label}</option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label>{t('budgets.fund')}</label>
                <select value={form.fundId} onChange={handleChange('fundId')} required>
                  <option value="" disabled>—</option>
                  {funds.map((f) => (
                    <option key={f.id} value={f.id}>{f.name}</option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label>{t('budgets.type')}</label>
                <select value={form.type} onChange={handleChange('type')}>
                  <option value="expense">{t('nav.expenses')}</option>
                  <option value="income">{t('nav.contributions')}</option>
                </select>
              </div>
              <div className="field">
                <label>{t('budgets.category')}</label>
                <select value={form.categoryId} onChange={handleChange('categoryId')}>
                  <option value="">—</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label>{t('budgets.budgetAmount')}</label>
                <input type="text" inputMode="decimal" placeholder="0.00" value={form.budgetAmount} onChange={handleChange('budgetAmount')} required />
              </div>
            </div>
            <div className="form-actions">
              <button type="submit" className="btn btn--primary" disabled={submitting}>
                {submitting ? t('common.loading') : t('common.create')}
              </button>
            </div>
          </form>
        </div>
      </PermissionGate>

      <div className="card">
        {loading ? (
          <SkeletonTable rows={4} columns={6} />
        ) : budgets.length === 0 ? (
          <div className="empty-state">{t('common.noResults')}</div>
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>{t('budgets.fund')}</th>
                  <th>{t('budgets.category')}</th>
                  <th>{t('budgets.type')}</th>
                  <th>{t('budgets.budgetAmount')}</th>
                  <th>{t('budgets.actual')}</th>
                  <th>{t('budgets.variance')}</th>
                </tr>
              </thead>
              <tbody>
                {budgets.map((b) => (
                  <tr key={b.id}>
                    <td>{funds.find((f) => f.id === b.fund_id)?.name ?? '—'}</td>
                    <td>{categories.find((c) => c.id === b.category_id)?.name ?? '—'}</td>
                    <td>{b.type === 'income' ? t('nav.contributions') : t('nav.expenses')}</td>
                    <td>{formatMoney(b.budget_amount)}</td>
                    <td>{formatMoney(b.actual_amount)}</td>
                    <td style={{ color: Number(b.variance) < 0 ? 'var(--color-danger)' : 'var(--color-success)' }}>
                      {formatMoney(b.variance)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
