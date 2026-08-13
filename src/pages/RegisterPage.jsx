import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { useLocale } from '../i18n/LocaleContext.jsx';
import { authApi } from '../api/endpoints.js';
import { unwrapApiError } from '../api/client.js';

function emptyForm() {
  return { churchName: '', adminFullName: '', adminEmail: '', adminPassword: '', confirmPassword: '' };
}

// The only way a brand-new church gets into the product — creates the
// tenant, its church_settings row, the first user, and assigns that user
// the Super Administrator role, all atomically on the backend
// (server/src/modules/auth/auth.service.js#registerTenant, unchanged by
// this fix). That endpoint doesn't itself issue a session, so on success
// this page logs in through the exact same AuthContext#login every
// returning user goes through — no second, competing auth path.
export default function RegisterPage() {
  const { login } = useAuth();
  const { t } = useLocale();
  const navigate = useNavigate();
  const [form, setForm] = useState(emptyForm());
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const handleChange = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);

    if (form.adminPassword !== form.confirmPassword) {
      setError(t('auth.register.passwordMismatch'));
      return;
    }

    setSubmitting(true);
    try {
      const { tenant } = await authApi.registerTenant({
        churchName: form.churchName,
        adminFullName: form.adminFullName,
        adminEmail: form.adminEmail,
        adminPassword: form.adminPassword,
      });
      // Same call LoginPage makes — registration doesn't issue its own
      // session, so this is the one real login of the new admin's first visit.
      await login({ tenantSlug: tenant.slug, email: form.adminEmail, password: form.adminPassword });
      navigate('/', { replace: true });
    } catch (err) {
      setError(unwrapApiError(err).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-card__brand">{t('app.name')}</div>
        <div className="auth-card__subtitle">{t('auth.register.subtitle')}</div>
        {error && <div className="alert alert--error">{error}</div>}
        <form onSubmit={handleSubmit}>
          <div className="field">
            <label htmlFor="churchName">{t('auth.register.churchName')}</label>
            <input
              id="churchName"
              value={form.churchName}
              onChange={handleChange('churchName')}
              autoComplete="organization"
              required
            />
          </div>
          <div className="field">
            <label htmlFor="adminFullName">{t('auth.register.adminFullName')}</label>
            <input
              id="adminFullName"
              value={form.adminFullName}
              onChange={handleChange('adminFullName')}
              autoComplete="name"
              required
            />
          </div>
          <div className="field">
            <label htmlFor="adminEmail">{t('auth.login.email')}</label>
            <input
              id="adminEmail"
              type="email"
              value={form.adminEmail}
              onChange={handleChange('adminEmail')}
              autoComplete="email"
              required
            />
          </div>
          <div className="field">
            <label htmlFor="adminPassword">{t('auth.login.password')}</label>
            <input
              id="adminPassword"
              type="password"
              value={form.adminPassword}
              onChange={handleChange('adminPassword')}
              autoComplete="new-password"
              minLength={10}
              required
            />
          </div>
          <div className="field">
            <label htmlFor="confirmPassword">{t('auth.register.confirmPassword')}</label>
            <input
              id="confirmPassword"
              type="password"
              value={form.confirmPassword}
              onChange={handleChange('confirmPassword')}
              autoComplete="new-password"
              minLength={10}
              required
            />
          </div>
          <button type="submit" className="btn btn--primary" disabled={submitting}>
            {submitting ? t('common.loading') : t('auth.register.submit')}
          </button>
        </form>
        <p className="auth-card__subtitle" style={{ marginTop: 16, marginBottom: 0 }}>
          {t('auth.register.haveAccount')} <Link to="/login">{t('auth.login.submit')}</Link>
        </p>
      </div>
    </div>
  );
}
