import { useCallback, useEffect, useState } from 'react';
import { transfersApi, accountsApi, fundsApi } from '../api/endpoints.js';
import { unwrapApiError } from '../api/client.js';
import { useLocale } from '../i18n/LocaleContext.jsx';
import { useToast } from '../components/Toast.jsx';
import PermissionGate from '../components/PermissionGate.jsx';
import { formatMoney, formatDate } from '../utils/format.js';

function emptyForm() {
  return { fromAccountId: '', toAccountId: '', fromFundId: '', toFundId: '', amount: '', description: '' };
}

export default function TransfersPage() {
  const { t } = useLocale();
  const toast = useToast();
  const [transfers, setTransfers] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [funds, setFunds] = useState([]);
  const [form, setForm] = useState(emptyForm());
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [transferData, accountData, fundData] = await Promise.all([
        transfersApi.list(),
        accountsApi.list(),
        fundsApi.list(),
      ]);
      setTransfers(transferData);
      setAccounts(accountData);
      setFunds(fundData);
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
      await transfersApi.create({
        ...form,
        fromAccountId: Number(form.fromAccountId),
        toAccountId: Number(form.toAccountId),
        fromFundId: Number(form.fromFundId),
        toFundId: Number(form.toFundId),
      });
      setForm(emptyForm());
      await load();
      toast.success(t('transfers.created'));
    } catch (err) {
      setError(unwrapApiError(err).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div>
      <h1>{t('transfers.title')}</h1>
      {error && <div className="alert alert--error">{error}</div>}

      <PermissionGate permission="transfers.create">
        <div className="card">
          <div className="card__header">
            <h2>{t('transfers.new')}</h2>
          </div>
          <form onSubmit={handleSubmit}>
            <div className="form-grid">
              <div className="field">
                <label>{t('common.amount')}</label>
                <input type="text" inputMode="decimal" placeholder="0.00" value={form.amount} onChange={handleChange('amount')} required />
              </div>
              <div className="field">
                <label>{t('transfers.fromAccount')}</label>
                <select value={form.fromAccountId} onChange={handleChange('fromAccountId')} required>
                  <option value="" disabled>—</option>
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>{a.name}</option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label>{t('transfers.toAccount')}</label>
                <select value={form.toAccountId} onChange={handleChange('toAccountId')} required>
                  <option value="" disabled>—</option>
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>{a.name}</option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label>{t('transfers.fromFund')}</label>
                <select value={form.fromFundId} onChange={handleChange('fromFundId')} required>
                  <option value="" disabled>—</option>
                  {funds.map((f) => (
                    <option key={f.id} value={f.id}>{f.name}</option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label>{t('transfers.toFund')}</label>
                <select value={form.toFundId} onChange={handleChange('toFundId')} required>
                  <option value="" disabled>—</option>
                  {funds.map((f) => (
                    <option key={f.id} value={f.id}>{f.name}</option>
                  ))}
                </select>
              </div>
              <div className="field field--full">
                <label>{t('common.notes')}</label>
                <input value={form.description} onChange={handleChange('description')} />
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
        {loading ? (
          <div className="empty-state">{t('common.loading')}</div>
        ) : transfers.length === 0 ? (
          <div className="empty-state">{t('common.noResults')}</div>
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>{t('common.date')}</th>
                  <th>{t('common.amount')}</th>
                  <th>{t('common.reference')}</th>
                </tr>
              </thead>
              <tbody>
                {transfers.map((tr) => (
                  <tr key={tr.id}>
                    <td>{formatDate(tr.created_at)}</td>
                    <td>{formatMoney(tr.amount)}</td>
                    <td>{tr.transaction_number}</td>
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
