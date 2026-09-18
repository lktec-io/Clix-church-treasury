import { useCallback, useEffect, useState } from 'react';
import { transfersApi, accountsApi, fundsApi } from '../api/endpoints.js';
import { unwrapApiError } from '../api/client.js';
import { useLocale } from '../i18n/LocaleContext.jsx';
import { useToast } from '../components/Toast.jsx';
import PermissionGate from '../components/PermissionGate.jsx';
import PageHeader from '../components/ui/PageHeader.jsx';
import Dropdown from '../components/ui/Dropdown.jsx';
import { SkeletonTable } from '../components/ui/Skeleton.jsx';
import { formatMoney, formatDate, sanitizeAmountInput } from '../utils/format.js';

function emptyForm() {
  return { fromAccountId: '', toAccountId: '', fromFundId: '', toFundId: '', amount: '', description: '' };
}

// The four required choices, rendered from one list so the account and fund
// pairs cannot drift apart.
const ACCOUNT_FIELDS = [
  { field: 'fromAccountId', labelKey: 'transfers.fromAccount', source: 'accounts' },
  { field: 'toAccountId', labelKey: 'transfers.toAccount', source: 'accounts' },
  { field: 'fromFundId', labelKey: 'transfers.fromFund', source: 'funds' },
  { field: 'toFundId', labelKey: 'transfers.toFund', source: 'funds' },
];

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
  const [fieldErrors, setFieldErrors] = useState({});

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
  // Clearing the field's error as it is answered keeps the message from
  // lingering next to a control that is now valid.
  const setField = (field) => (value) => {
    setForm((f) => ({ ...f, [field]: value }));
    setFieldErrors((errors) => ({ ...errors, [field]: undefined }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    // Dropdowns are not native <select required>, so an empty choice is
    // caught here and reported inline instead of reaching the API.
    const errors = {};
    for (const { field } of ACCOUNT_FIELDS) {
      if (!form[field]) errors[field] = t('common.required');
    }
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;
    setSubmitting(true);
    try {
      await transfersApi.create({
        ...form,
        amount: sanitizeAmountInput(form.amount),
        fromAccountId: Number(form.fromAccountId),
        toAccountId: Number(form.toAccountId),
        fromFundId: Number(form.fromFundId),
        toFundId: Number(form.toFundId),
      });
      setForm(emptyForm());
      setFieldErrors({});
      await load();
      toast.success(t('transfers.created'));
    } catch (err) {
      setError(unwrapApiError(err).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="page">
      <PageHeader title={t('transfers.title')} />
      {error && <div className="alert alert--error">{error}</div>}

      <PermissionGate permission="transfers.create">
        <div className="card">
          <div className="card__header">
            <h2>{t('transfers.new')}</h2>
          </div>
          <form onSubmit={handleSubmit}>
            <div className="form-grid">
              <div className="field">
                <label htmlFor="transfer-amount">{t('common.amount')}</label>
                <div className="currency-input">
                  <span className="currency-input__prefix">TZS</span>
                  <input
                    id="transfer-amount"
                    type="text"
                    inputMode="decimal"
                    placeholder="0.00"
                    value={form.amount}
                    onChange={handleChange('amount')}
                    required
                  />
                </div>
              </div>
              {ACCOUNT_FIELDS.map(({ field, labelKey, source }) => (
                <div className="field" key={field}>
                  <Dropdown
                    id={`transfer-${field}`}
                    label={t(labelKey)}
                    options={(source === 'accounts' ? accounts : funds).map((row) => ({
                      value: String(row.id),
                      label: row.name,
                    }))}
                    value={form[field]}
                    onChange={setField(field)}
                    invalid={Boolean(fieldErrors[field])}
                    errorId={`transfer-${field}-error`}
                  />
                  {fieldErrors[field] && (
                    <span className="field-error" id={`transfer-${field}-error`}>
                      {fieldErrors[field]}
                    </span>
                  )}
                </div>
              ))}
              <div className="field field--full">
                <label htmlFor="transfer-notes">{t('common.notes')}</label>
                <input id="transfer-notes" value={form.description} onChange={handleChange('description')} />
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
          <SkeletonTable rows={4} columns={3} />
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
