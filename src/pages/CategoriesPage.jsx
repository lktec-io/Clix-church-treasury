import { useCallback, useEffect, useState } from 'react';
import { categoriesApi } from '../api/endpoints.js';
import { unwrapApiError } from '../api/client.js';
import { useLocale } from '../i18n/LocaleContext.jsx';
import { useToast } from '../components/Toast.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import PermissionGate from '../components/PermissionGate.jsx';

// Genuinely missing until now: income.view/expense.create both require a
// categoryId (server/src/modules/contributions/contributions.validator.js,
// expenses.validator.js), the backend endpoint has existed since Phase 4
// (categories.routes.js), but no screen ever called categoriesApi.create —
// a freshly-registered tenant had no category to select and could not
// record a contribution or expense at all. This page closes that gap,
// following the same list+create pattern as AccountsPage/FundsPage.
const REPORT_GROUPS = ['', 'tithe', 'offering', 'other'];

function emptyForm() {
  return { type: 'income', name: '', reportGroup: '' };
}

export default function CategoriesPage() {
  const { t } = useLocale();
  const { hasPermission } = useAuth();
  const toast = useToast();
  const [categories, setCategories] = useState([]);
  const [form, setForm] = useState(emptyForm());
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [loading, setLoading] = useState(true);
  const [savingGroupId, setSavingGroupId] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setCategories(await categoriesApi.list());
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

  const handleChange = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await categoriesApi.create({ ...form, reportGroup: form.reportGroup || null });
      setForm(emptyForm());
      await load();
      toast.success(t('categories.created'));
    } catch (err) {
      setError(unwrapApiError(err).message);
    } finally {
      setSubmitting(false);
    }
  };

  // The Zaka/Sadaka/Matoleo-Mengine split on every member statement is
  // driven entirely by this field (contributions/statement.service.js) —
  // exposing it as an inline, editable selector on already-existing
  // categories matters just as much as setting it at creation time, since
  // every tenant that registered before this feature existed has
  // categories with report_group still NULL.
  const handleReportGroupChange = async (category, reportGroup) => {
    setSavingGroupId(category.id);
    setError(null);
    try {
      await categoriesApi.update(category.id, { reportGroup: reportGroup || null });
      await load();
    } catch (err) {
      setError(unwrapApiError(err).message);
    } finally {
      setSavingGroupId(null);
    }
  };

  return (
    <div>
      <h1>{t('categories.title')}</h1>
      {error && <div className="alert alert--error">{error}</div>}

      <PermissionGate permission="categories.manage">
        <div className="card">
          <div className="card__header">
            <h2>{t('categories.addNew')}</h2>
          </div>
          <form onSubmit={handleSubmit}>
            <div className="form-grid">
              <div className="field">
                <label>{t('budgets.type')}</label>
                <select value={form.type} onChange={handleChange('type')}>
                  <option value="income">{t('nav.contributions')}</option>
                  <option value="expense">{t('nav.expenses')}</option>
                </select>
              </div>
              <div className="field">
                <label>{t('common.name')}</label>
                <input value={form.name} onChange={handleChange('name')} required />
              </div>
              {form.type === 'income' && (
                <div className="field">
                  <label>{t('categories.reportGroup')}</label>
                  <select value={form.reportGroup} onChange={handleChange('reportGroup')}>
                    {REPORT_GROUPS.map((g) => (
                      <option key={g || 'none'} value={g}>
                        {g ? t(`categories.reportGroup.${g}`) : t('categories.reportGroup.none')}
                      </option>
                    ))}
                  </select>
                </div>
              )}
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
          <div className="empty-state">{t('common.loading')}</div>
        ) : categories.length === 0 ? (
          <div className="empty-state">{t('categories.empty')}</div>
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>{t('common.name')}</th>
                  <th>{t('budgets.type')}</th>
                  <th>{t('categories.reportGroup')}</th>
                  <th>{t('common.status')}</th>
                </tr>
              </thead>
              <tbody>
                {categories.map((c) => (
                  <tr key={c.id}>
                    <td>{c.name}</td>
                    <td>{c.type === 'income' ? t('nav.contributions') : t('nav.expenses')}</td>
                    <td>
                      {c.type !== 'income' ? (
                        '—'
                      ) : hasPermission('categories.manage') ? (
                        <select
                          value={c.report_group ?? ''}
                          disabled={savingGroupId === c.id}
                          onChange={(e) => handleReportGroupChange(c, e.target.value)}
                        >
                          {REPORT_GROUPS.map((g) => (
                            <option key={g || 'none'} value={g}>
                              {g ? t(`categories.reportGroup.${g}`) : t('categories.reportGroup.none')}
                            </option>
                          ))}
                        </select>
                      ) : c.report_group ? (
                        t(`categories.reportGroup.${c.report_group}`)
                      ) : (
                        t('categories.reportGroup.none')
                      )}
                    </td>
                    <td>
                      <span className={`badge ${c.is_active ? 'badge--success' : 'badge--neutral'}`}>
                        {c.is_active ? t('common.active') : t('common.inactive')}
                      </span>
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
