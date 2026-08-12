import { useEffect, useState, useCallback } from 'react';
import { contributionsApi, accountsApi, fundsApi, categoriesApi, contributorsApi } from '../api/endpoints.js';
import { unwrapApiError } from '../api/client.js';
import { useLocale } from '../i18n/LocaleContext.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import PermissionGate from '../components/PermissionGate.jsx';
import { formatMoney, formatDate } from '../utils/format.js';

const PAYMENT_METHODS = ['cash', 'bank', 'mobile_money', 'cheque', 'other'];

function emptyForm() {
  return {
    amount: '',
    accountId: '',
    fundId: '',
    categoryId: '',
    contributorId: '',
    paymentMethod: 'cash',
    contributionDate: new Date().toISOString().slice(0, 10),
    reference: '',
    notes: '',
  };
}

export default function ContributionsPage() {
  const { t } = useLocale();
  const { hasPermission } = useAuth();
  const [contributions, setContributions] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [funds, setFunds] = useState([]);
  const [categories, setCategories] = useState([]);
  const [contributors, setContributors] = useState([]);
  const [form, setForm] = useState(emptyForm());
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [loading, setLoading] = useState(true);

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [contribData, accountData, fundData, categoryData] = await Promise.all([
        contributionsApi.list(),
        accountsApi.list(),
        fundsApi.list(),
        categoriesApi.list('income'),
      ]);
      setContributions(contribData);
      setAccounts(accountData);
      setFunds(fundData);
      setCategories(categoryData);
      if (hasPermission('contributors.view')) {
        setContributors(await contributorsApi.list());
      }
    } catch (err) {
      setError(unwrapApiError(err).message);
    } finally {
      setLoading(false);
    }
  }, [hasPermission]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleChange = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await contributionsApi.create({
        ...form,
        accountId: Number(form.accountId),
        fundId: Number(form.fundId),
        categoryId: Number(form.categoryId),
        contributorId: form.contributorId ? Number(form.contributorId) : null,
      });
      setForm(emptyForm());
      await loadAll();
    } catch (err) {
      setError(unwrapApiError(err).message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleReverse = async (id) => {
    const reason = window.prompt(t('common.reason'));
    if (!reason) return;
    try {
      await contributionsApi.reverse(id, reason);
      await loadAll();
    } catch (err) {
      setError(unwrapApiError(err).message);
    }
  };

  return (
    <div>
      <h1>{t('contributions.title')}</h1>
      {error && <div className="alert alert--error">{error}</div>}

      <PermissionGate permission="income.create">
        <div className="card">
          <div className="card__header">
            <h2>{t('contributions.recordNew')}</h2>
          </div>
          <form onSubmit={handleSubmit}>
            <div className="form-grid">
              <div className="field">
                <label>{t('common.amount')}</label>
                <input
                  type="text"
                  inputMode="decimal"
                  placeholder="0.00"
                  value={form.amount}
                  onChange={handleChange('amount')}
                  required
                />
              </div>
              <div className="field">
                <label>{t('contributions.account')}</label>
                <select value={form.accountId} onChange={handleChange('accountId')} required>
                  <option value="" disabled>
                    —
                  </option>
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label>{t('contributions.fund')}</label>
                <select value={form.fundId} onChange={handleChange('fundId')} required>
                  <option value="" disabled>
                    —
                  </option>
                  {funds.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label>{t('contributions.category')}</label>
                <select value={form.categoryId} onChange={handleChange('categoryId')} required>
                  <option value="" disabled>
                    —
                  </option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label>{t('contributions.paymentMethod')}</label>
                <select value={form.paymentMethod} onChange={handleChange('paymentMethod')} required>
                  {PAYMENT_METHODS.map((m) => (
                    <option key={m} value={m}>
                      {t(`paymentMethod.${m}`)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label>{t('contributions.contributionDate')}</label>
                <input type="date" value={form.contributionDate} onChange={handleChange('contributionDate')} required />
              </div>
              {contributors.length > 0 && (
                <div className="field">
                  <label>{t('contributions.contributor')}</label>
                  <select value={form.contributorId} onChange={handleChange('contributorId')}>
                    <option value="">—</option>
                    {contributors.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.full_name}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <div className="field">
                <label>{t('common.reference')}</label>
                <input value={form.reference} onChange={handleChange('reference')} />
              </div>
              <div className="field field--full">
                <label>{t('common.notes')}</label>
                <textarea rows={2} value={form.notes} onChange={handleChange('notes')} />
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
          <h2>{t('contributions.title')}</h2>
        </div>
        {loading ? (
          <div className="empty-state">{t('common.loading')}</div>
        ) : contributions.length === 0 ? (
          <div className="empty-state">{t('common.noResults')}</div>
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>{t('common.date')}</th>
                  <th>{t('common.amount')}</th>
                  {contributions.some((c) => c.contributor) && <th>{t('contributions.contributor')}</th>}
                  <th>{t('contributions.paymentMethod')}</th>
                  <th>{t('common.status')}</th>
                  <th>{t('common.actions')}</th>
                </tr>
              </thead>
              <tbody>
                {contributions.map((c) => (
                  <tr key={c.id}>
                    <td>{formatDate(c.contribution_date)}</td>
                    <td>{formatMoney(c.amount)}</td>
                    {contributions.some((row) => row.contributor) && <td>{c.contributor?.full_name ?? '—'}</td>}
                    <td>{t(`paymentMethod.${c.payment_method}`)}</td>
                    <td>
                      <span className={`badge ${c.status === 'reversed' ? 'badge--danger' : 'badge--success'}`}>
                        {c.status === 'reversed' ? t('contributions.reversed') : t('common.active')}
                      </span>
                    </td>
                    <td>
                      {c.status === 'posted' && (
                        <PermissionGate permission="income.reverse">
                          <button type="button" className="btn btn--secondary btn--sm" onClick={() => handleReverse(c.id)}>
                            {t('contributions.reverse')}
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
      </div>
    </div>
  );
}
