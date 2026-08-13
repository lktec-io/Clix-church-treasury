import { useCallback, useEffect, useState } from 'react';
import { categoriesApi } from '../api/endpoints.js';
import { unwrapApiError } from '../api/client.js';
import { useLocale } from '../i18n/LocaleContext.jsx';
import { useToast } from '../components/Toast.jsx';
import PermissionGate from '../components/PermissionGate.jsx';

// Genuinely missing until now: income.view/expense.create both require a
// categoryId (server/src/modules/contributions/contributions.validator.js,
// expenses.validator.js), the backend endpoint has existed since Phase 4
// (categories.routes.js), but no screen ever called categoriesApi.create —
// a freshly-registered tenant had no category to select and could not
// record a contribution or expense at all. This page closes that gap,
// following the same list+create pattern as AccountsPage/FundsPage.
function emptyForm() {
  return { type: 'income', name: '' };
}

export default function CategoriesPage() {
  const { t } = useLocale();
  const toast = useToast();
  const [categories, setCategories] = useState([]);
  const [form, setForm] = useState(emptyForm());
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [loading, setLoading] = useState(true);

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
      await categoriesApi.create(form);
      setForm(emptyForm());
      await load();
      toast.success(t('categories.created'));
    } catch (err) {
      setError(unwrapApiError(err).message);
    } finally {
      setSubmitting(false);
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
                  <th>{t('common.status')}</th>
                </tr>
              </thead>
              <tbody>
                {categories.map((c) => (
                  <tr key={c.id}>
                    <td>{c.name}</td>
                    <td>{c.type === 'income' ? t('nav.contributions') : t('nav.expenses')}</td>
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
