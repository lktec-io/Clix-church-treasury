import { useCallback, useEffect, useState } from 'react';
import { budgetsApi, financialPeriodsApi, fundsApi, categoriesApi } from '../api/endpoints.js';
import { unwrapApiError } from '../api/client.js';
import { useLocale } from '../i18n/LocaleContext.jsx';
import { useToast } from '../components/Toast.jsx';
import PermissionGate from '../components/PermissionGate.jsx';
import PageHeader from '../components/ui/PageHeader.jsx';
import Dropdown from '../components/ui/Dropdown.jsx';
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
  const [fieldErrors, setFieldErrors] = useState({});
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

  // Same as handleChange, for the dropdowns: keeps the category reload when
  // the budget type changes, and clears a field error once answered.
  const setField = (field) => (value) => {
    setForm((f) => ({ ...f, [field]: value }));
    setFieldErrors((errors) => ({ ...errors, [field]: undefined }));
    if (field === 'type') loadCategories(value);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    // The dropdowns carry no native required check; report gaps inline.
    const errors = {};
    if (!form.financialPeriodId) errors.financialPeriodId = t('common.required');
    if (!form.fundId) errors.fundId = t('common.required');
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;
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
      setFieldErrors({});
      await loadBudgets(selectedPeriodId);
      toast.success(t('budgets.created'));
    } catch (err) {
      setError(unwrapApiError(err).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="page">
      <PageHeader title={t('budgets.title')} />
      {error && <div className="alert alert--error">{error}</div>}

      <div className="card filter-bar">
        <div className="field filter-bar__field">
          <Dropdown
            id="budget-period-filter"
            label={t('budgets.financialPeriod')}
            options={periods.map((p) => ({
              value: String(p.id),
              label: p.label,
              meta: t(`financialPeriods.status.${p.status}`),
            }))}
            value={String(selectedPeriodId ?? '')}
            onChange={(id) => setSelectedPeriodId(Number(id))}
          />
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
                <Dropdown
                  id="budget-period"
                  label={t('budgets.financialPeriod')}
                  options={periods.map((p) => ({ value: String(p.id), label: p.label }))}
                  value={form.financialPeriodId}
                  onChange={setField('financialPeriodId')}
                  invalid={Boolean(fieldErrors.financialPeriodId)}
                  errorId="budget-period-error"
                />
                {fieldErrors.financialPeriodId && (
                  <span className="field-error" id="budget-period-error">{fieldErrors.financialPeriodId}</span>
                )}
              </div>
              <div className="field">
                <Dropdown
                  id="budget-fund"
                  label={t('budgets.fund')}
                  options={funds.map((f) => ({ value: String(f.id), label: f.name }))}
                  value={form.fundId}
                  onChange={setField('fundId')}
                  invalid={Boolean(fieldErrors.fundId)}
                  errorId="budget-fund-error"
                />
                {fieldErrors.fundId && <span className="field-error" id="budget-fund-error">{fieldErrors.fundId}</span>}
              </div>
              <div className="field">
                <Dropdown
                  id="budget-type"
                  label={t('budgets.type')}
                  options={[
                    { value: 'expense', label: t('nav.expenses') },
                    { value: 'income', label: t('nav.contributions') },
                  ]}
                  value={form.type}
                  onChange={setField('type')}
                />
              </div>
              <div className="field">
                <Dropdown
                  id="budget-category"
                  label={t('budgets.category')}
                  options={[{ value: '', label: '—' }, ...categories.map((c) => ({ value: String(c.id), label: c.name }))]}
                  value={form.categoryId}
                  onChange={setField('categoryId')}
                />
              </div>
              <div className="field">
                <label htmlFor="budget-amount">{t('budgets.budgetAmount')}</label>
                <div className="currency-input">
                  <span className="currency-input__prefix">TZS</span>
                  <input
                    id="budget-amount"
                    type="text"
                    inputMode="decimal"
                    placeholder="0.00"
                    value={form.budgetAmount}
                    onChange={handleChange('budgetAmount')}
                    required
                  />
                </div>
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
                    <td className={`is-amount ${Number(b.variance) < 0 ? 'is-expense' : 'is-income'}`}>
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
