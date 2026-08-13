import { useCallback, useEffect, useState } from 'react';
import { contributorsApi } from '../api/endpoints.js';
import { unwrapApiError } from '../api/client.js';
import { useLocale } from '../i18n/LocaleContext.jsx';
import { useToast } from '../components/Toast.jsx';
import PermissionGate from '../components/PermissionGate.jsx';

function emptyForm() {
  return { fullName: '', phone: '', email: '', memberNumber: '' };
}

export default function ContributorsPage() {
  const { t } = useLocale();
  const toast = useToast();
  const [contributors, setContributors] = useState([]);
  const [form, setForm] = useState(emptyForm());
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setContributors(await contributorsApi.list());
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
      await contributorsApi.create(form);
      setForm(emptyForm());
      await load();
      toast.success(t('contributors.created'));
    } catch (err) {
      setError(unwrapApiError(err).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div>
      <h1>{t('contributors.title')}</h1>
      {error && <div className="alert alert--error">{error}</div>}

      <PermissionGate permission="contributors.manage">
        <div className="card">
          <div className="card__header">
            <h2>{t('contributors.addNew')}</h2>
          </div>
          <form onSubmit={handleSubmit}>
            <div className="form-grid">
              <div className="field">
                <label>{t('contributors.fullName')}</label>
                <input value={form.fullName} onChange={handleChange('fullName')} required />
              </div>
              <div className="field">
                <label>{t('contributors.phone')}</label>
                <input value={form.phone} onChange={handleChange('phone')} />
              </div>
              <div className="field">
                <label>{t('contributors.email')}</label>
                <input type="email" value={form.email} onChange={handleChange('email')} />
              </div>
              <div className="field">
                <label>{t('contributors.memberNumber')}</label>
                <input value={form.memberNumber} onChange={handleChange('memberNumber')} />
              </div>
            </div>
            <div className="form-actions">
              <button type="submit" className="btn btn--primary" disabled={submitting}>
                {submitting ? t('common.loading') : t('common.save')}
              </button>
            </div>
          </form>
        </div>
      </PermissionGate>

      <div className="card">
        {loading ? (
          <div className="empty-state">{t('common.loading')}</div>
        ) : contributors.length === 0 ? (
          <div className="empty-state">{t('common.noResults')}</div>
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>{t('contributors.fullName')}</th>
                  <th>{t('contributors.phone')}</th>
                  <th>{t('contributors.email')}</th>
                  <th>{t('contributors.memberNumber')}</th>
                </tr>
              </thead>
              <tbody>
                {contributors.map((c) => (
                  <tr key={c.id}>
                    <td>{c.full_name}</td>
                    <td>{c.phone ?? '—'}</td>
                    <td>{c.email ?? '—'}</td>
                    <td>{c.member_number ?? '—'}</td>
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
