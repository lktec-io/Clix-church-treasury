import { useCallback, useEffect, useState } from 'react';
import { financialPeriodsApi } from '../api/endpoints.js';
import { unwrapApiError } from '../api/client.js';
import { useLocale } from '../i18n/LocaleContext.jsx';
import PermissionGate from '../components/PermissionGate.jsx';
import { formatMoney } from '../utils/format.js';

function emptyForm() {
  return { label: '', startDate: '', endDate: '' };
}

export default function FinancialPeriodsPage() {
  const { t } = useLocale();
  const [periods, setPeriods] = useState([]);
  const [selected, setSelected] = useState(null);
  const [summary, setSummary] = useState(null);
  const [checklist, setChecklist] = useState(null);
  const [form, setForm] = useState(emptyForm());
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await financialPeriodsApi.list();
      setPeriods(data);
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

  const viewPeriod = async (period) => {
    setSelected(period);
    setSummary(null);
    setChecklist(null);
    try {
      setSummary(await financialPeriodsApi.summary(period.id));
      if (period.status === 'open') {
        setChecklist(await financialPeriodsApi.checklist(period.id));
      }
    } catch (err) {
      setError(unwrapApiError(err).message);
    }
  };

  const handleCreate = async (e) => {
    e.preventDefault();
    setError(null);
    try {
      await financialPeriodsApi.create(form);
      setForm(emptyForm());
      await load();
    } catch (err) {
      setError(unwrapApiError(err).message);
    }
  };

  const handleClose = async (period) => {
    if (!window.confirm(t('financialPeriods.close') + '?')) return;
    try {
      await financialPeriodsApi.close(period.id);
      await load();
      setSelected(null);
    } catch (err) {
      setError(unwrapApiError(err).message);
    }
  };

  const handleReopen = async (period) => {
    const reason = window.prompt(t('common.reason'));
    if (!reason) return;
    try {
      await financialPeriodsApi.reopen(period.id, reason);
      await load();
      setSelected(null);
    } catch (err) {
      setError(unwrapApiError(err).message);
    }
  };

  return (
    <div>
      <h1>{t('financialPeriods.title')}</h1>
      {error && <div className="alert alert--error">{error}</div>}

      <PermissionGate permission="financial_period.manage">
        <div className="card">
          <div className="card__header">
            <h2>{t('financialPeriods.new')}</h2>
          </div>
          <form onSubmit={handleCreate}>
            <div className="form-grid">
              <div className="field">
                <label>{t('financialPeriods.label')}</label>
                <input value={form.label} onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))} required />
              </div>
              <div className="field">
                <label>{t('financialPeriods.startDate')}</label>
                <input type="date" value={form.startDate} onChange={(e) => setForm((f) => ({ ...f, startDate: e.target.value }))} required />
              </div>
              <div className="field">
                <label>{t('financialPeriods.endDate')}</label>
                <input type="date" value={form.endDate} onChange={(e) => setForm((f) => ({ ...f, endDate: e.target.value }))} required />
              </div>
            </div>
            <div className="form-actions">
              <button type="submit" className="btn btn--primary">{t('common.create')}</button>
            </div>
          </form>
        </div>
      </PermissionGate>

      <div className="card">
        {loading ? (
          <div className="empty-state">{t('common.loading')}</div>
        ) : periods.length === 0 ? (
          <div className="empty-state">{t('common.noResults')}</div>
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>{t('financialPeriods.label')}</th>
                  <th>{t('financialPeriods.startDate')}</th>
                  <th>{t('financialPeriods.endDate')}</th>
                  <th>{t('common.status')}</th>
                  <th>{t('common.actions')}</th>
                </tr>
              </thead>
              <tbody>
                {periods.map((p) => (
                  <tr key={p.id}>
                    <td>{p.label}</td>
                    <td>{p.start_date}</td>
                    <td>{p.end_date}</td>
                    <td>
                      <span className={`badge ${p.status === 'open' ? 'badge--success' : 'badge--neutral'}`}>
                        {t(`financialPeriods.status.${p.status}`)}
                      </span>
                    </td>
                    <td style={{ display: 'flex', gap: 6 }}>
                      <button type="button" className="btn btn--secondary btn--sm" onClick={() => viewPeriod(p)}>
                        {t('financialPeriods.closingSummary')}
                      </button>
                      {p.status === 'open' && (
                        <PermissionGate permission="financial_period.close">
                          <button type="button" className="btn btn--secondary btn--sm" onClick={() => handleClose(p)}>
                            {t('financialPeriods.close')}
                          </button>
                        </PermissionGate>
                      )}
                      {p.status === 'closed' && (
                        <PermissionGate permission="financial_period.reopen">
                          <button type="button" className="btn btn--secondary btn--sm" onClick={() => handleReopen(p)}>
                            {t('financialPeriods.reopen')}
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

      {selected && summary && (
        <div className="card">
          <div className="card__header">
            <h2>{t('financialPeriods.closingSummary')} — {selected.label}</h2>
          </div>
          <div className="stat-grid">
            <div className="stat-tile">
              <div className="stat-tile__label">{t('financialPeriods.openingBalance')}</div>
              <div className="stat-tile__value">{formatMoney(summary.openingBalance)}</div>
            </div>
            <div className="stat-tile">
              <div className="stat-tile__label">{t('financialPeriods.totalIncome')}</div>
              <div className="stat-tile__value is-positive">{formatMoney(summary.totalIncome)}</div>
            </div>
            <div className="stat-tile">
              <div className="stat-tile__label">{t('financialPeriods.totalExpenses')}</div>
              <div className="stat-tile__value is-negative">{formatMoney(summary.totalExpenses)}</div>
            </div>
            <div className="stat-tile">
              <div className="stat-tile__label">{t('financialPeriods.closingBalance')}</div>
              <div className="stat-tile__value">{formatMoney(summary.closingBalance)}</div>
            </div>
          </div>

          {checklist && (
            <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>
              {t('financialPeriods.pendingExpenses')}: {checklist.pendingApprovalCount + checklist.approvedUnpaidCount}
            </p>
          )}

          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>{t('funds.title')}</th>
                  <th>{t('common.amount')}</th>
                </tr>
              </thead>
              <tbody>
                {summary.fundSummaries.map((f) => (
                  <tr key={f.fundId}>
                    <td>{f.name}</td>
                    <td>{formatMoney(f.balance)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
