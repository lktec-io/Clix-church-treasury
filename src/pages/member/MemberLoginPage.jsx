import { useState } from 'react';
import { useNavigate, useLocation, useParams } from 'react-router-dom';
import { useMemberAuth } from '../../context/MemberAuthContext.jsx';
import { useLocale } from '../../i18n/LocaleContext.jsx';
import { MEMBER_TENANT_SLUG_KEY } from '../../components/member/memberTenantSlug.js';

// Reached either via a personalized link (/member/:tenantSlug — what a
// registration/reset SMS points a member at, so tenantSlug is prefilled
// and hidden) or the bare /member URL (tenantSlug then shown as a normal
// editable field, same as the staff LoginPage's own tenantSlug input).
export default function MemberLoginPage() {
  const { login } = useMemberAuth();
  const { t } = useLocale();
  const navigate = useNavigate();
  const location = useLocation();
  const { tenantSlug: tenantSlugParam } = useParams();
  const [form, setForm] = useState({ tenantSlug: tenantSlugParam ?? '', memberNumber: '', pin: '' });
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const handleChange = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await login(form);
      try {
        localStorage.setItem(MEMBER_TENANT_SLUG_KEY, form.tenantSlug);
      } catch {
        // Non-fatal — just means the next forced-logout redirect falls back to /member.
      }
      navigate(location.state?.from?.pathname ?? '/member/dashboard', { replace: true });
    } catch (err) {
      setError(err.message ?? t('member.login.error'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-card__brand">{t('app.name')}</div>
        <div className="auth-card__subtitle">{t('member.login.subtitle')}</div>
        {error && <div className="alert alert--error">{error}</div>}
        <form onSubmit={handleSubmit}>
          {!tenantSlugParam && (
            <div className="field">
              <label htmlFor="tenantSlug">{t('auth.login.tenantSlug')}</label>
              <input
                id="tenantSlug"
                value={form.tenantSlug}
                onChange={handleChange('tenantSlug')}
                autoComplete="organization"
                required
              />
            </div>
          )}
          <div className="field">
            <label htmlFor="memberNumber">{t('member.login.memberNumber')}</label>
            <input
              id="memberNumber"
              value={form.memberNumber}
              onChange={handleChange('memberNumber')}
              autoComplete="username"
              required
            />
          </div>
          <div className="field">
            <label htmlFor="pin">{t('member.login.pin')}</label>
            <input
              id="pin"
              type="password"
              inputMode="numeric"
              maxLength={4}
              value={form.pin}
              onChange={handleChange('pin')}
              autoComplete="current-password"
              required
            />
          </div>
          <button type="submit" className="btn btn--primary" disabled={submitting}>
            {submitting ? t('common.loading') : t('member.login.submit')}
          </button>
        </form>
      </div>
    </div>
  );
}
