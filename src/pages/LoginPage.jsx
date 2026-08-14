import { useState } from 'react';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { FiShield } from 'react-icons/fi';
import { useAuth } from '../context/AuthContext.jsx';
import { useLocale } from '../i18n/LocaleContext.jsx';

export default function LoginPage() {
  const { login } = useAuth();
  const { t } = useLocale();
  const navigate = useNavigate();
  const location = useLocation();
  const [form, setForm] = useState({ tenantSlug: '', email: '', password: '' });
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const handleChange = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await login(form);
      navigate(location.state?.from?.pathname ?? '/', { replace: true });
    } catch (err) {
      setError(err.message ?? t('auth.login.error'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="auth-page">
      <motion.div
        className="auth-card"
        initial={{ opacity: 0, y: 14, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1, transition: { duration: 0.3, ease: [0.22, 1, 0.36, 1] } }}
      >
        <div className="auth-card__brand">
          <span className="auth-card__brand-mark">
            <FiShield aria-hidden="true" />
          </span>
          {t('app.name')}
        </div>
        <div className="auth-card__subtitle">{t('auth.login.subtitle')}</div>
        {error && <div className="alert alert--error">{error}</div>}
        <form onSubmit={handleSubmit}>
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
          <div className="field">
            <label htmlFor="email">{t('auth.login.email')}</label>
            <input
              id="email"
              type="email"
              value={form.email}
              onChange={handleChange('email')}
              autoComplete="email"
              required
            />
          </div>
          <div className="field">
            <label htmlFor="password">{t('auth.login.password')}</label>
            <input
              id="password"
              type="password"
              value={form.password}
              onChange={handleChange('password')}
              autoComplete="current-password"
              required
            />
          </div>
          <button type="submit" className="btn btn--primary" disabled={submitting}>
            {submitting ? t('common.loading') : t('auth.login.submit')}
          </button>
        </form>
        <p className="auth-card__subtitle" style={{ marginTop: 16, marginBottom: 0 }}>
          {t('auth.login.needAccount')} <Link to="/register">{t('auth.register.submit')}</Link>
        </p>
      </motion.div>
    </div>
  );
}
