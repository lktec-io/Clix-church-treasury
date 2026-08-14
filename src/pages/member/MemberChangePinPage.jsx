import { useState } from 'react';
import { memberAuthApi } from '../../api/memberEndpoints.js';
import { unwrapApiError } from '../../api/client.js';
import { useMemberAuth } from '../../context/MemberAuthContext.jsx';
import { useLocale } from '../../i18n/LocaleContext.jsx';
import { useToast } from '../../components/Toast.jsx';

export default function MemberChangePinPage() {
  const { t } = useLocale();
  const { refreshSession, session } = useMemberAuth();
  const toast = useToast();
  const [form, setForm] = useState({ currentPin: '', newPin: '', confirmPin: '' });
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const handleChange = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    if (form.newPin !== form.confirmPin) {
      setError(t('member.changePin.mismatch'));
      return;
    }
    setSubmitting(true);
    try {
      await memberAuthApi.changePin({ currentPin: form.currentPin, newPin: form.newPin });
      await refreshSession();
      setForm({ currentPin: '', newPin: '', confirmPin: '' });
      toast.success(t('member.changePin.success'));
    } catch (err) {
      setError(unwrapApiError(err).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div>
      <h1>{t('member.changePin.title')}</h1>
      {session?.mustChangePin && <div className="alert alert--warning">{t('member.changePin.required')}</div>}
      {error && <div className="alert alert--error">{error}</div>}
      <div className="card">
        <form onSubmit={handleSubmit}>
          <div className="form-grid">
            <div className="field">
              <label htmlFor="currentPin">{t('member.changePin.current')}</label>
              <input
                id="currentPin"
                type="password"
                inputMode="numeric"
                maxLength={4}
                value={form.currentPin}
                onChange={handleChange('currentPin')}
                autoComplete="current-password"
                required
              />
            </div>
            <div className="field">
              <label htmlFor="newPin">{t('member.changePin.new')}</label>
              <input
                id="newPin"
                type="password"
                inputMode="numeric"
                maxLength={4}
                value={form.newPin}
                onChange={handleChange('newPin')}
                autoComplete="new-password"
                required
              />
            </div>
            <div className="field">
              <label htmlFor="confirmPin">{t('member.changePin.confirm')}</label>
              <input
                id="confirmPin"
                type="password"
                inputMode="numeric"
                maxLength={4}
                value={form.confirmPin}
                onChange={handleChange('confirmPin')}
                autoComplete="new-password"
                required
              />
            </div>
          </div>
          <div className="form-actions">
            <button type="submit" className="btn btn--primary" disabled={submitting}>
              {submitting ? t('common.loading') : t('common.save')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
