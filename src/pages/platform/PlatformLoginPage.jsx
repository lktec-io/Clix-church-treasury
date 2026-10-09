import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { FiEye, FiEyeOff, FiShield } from 'react-icons/fi';
import { useAuth } from '../../context/AuthContext.jsx';
import { useLocale } from '../../i18n/LocaleContext.jsx';

// A clean, dedicated entry point for the Platform Administrator — reuses
// the EXACT SAME authentication system as the tenant /login page, never a
// second/parallel auth mechanism. It posts to /auth/platform-login, which
// delegates to the same login service and additionally:
//   1. resolves the internal platform tenant SERVER-side, so no tenant
//      identifier is hardcoded or known here, and
//   2. refuses to issue a session at all to an account without
//      platform.manage — so a non-platform user never briefly holds a
//      valid session from this door.
export default function PlatformLoginPage() {
  const { platformLogin } = useAuth();
  const { t } = useLocale();
  const navigate = useNavigate();
  const [form, setForm] = useState({ email: '', password: '' });
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  // Stored exactly as typed or pasted; see LoginPage.jsx.
  const handleChange = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      // Email trimmed (pasted whitespace), password sent exactly as entered.
      const session = await platformLogin({ email: form.email.trim(), password: form.password });
      // Defence in depth — the server already refuses to issue a session
      // without platform.manage, so this should be unreachable; it exists
      // so a future server-side regression can't silently drop a
      // non-platform user into the platform console.
      if (!session.permissions?.includes('platform.manage')) {
        setError(t('platform.login.notAdmin'));
        return;
      }
      navigate('/platform', { replace: true });
    } catch (err) {
      setError(err.message ?? t('platform.login.error'));
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
          {t('platform.brand')}
        </div>
        <div className="auth-card__subtitle">{t('platform.login.subtitle')}</div>
        {error && <div className="alert alert--error">{error}</div>}
        <form onSubmit={handleSubmit} method="post">
          <div className="field">
            <label htmlFor="platformEmail">{t('auth.login.email')}</label>
            <input
              id="platformEmail"
              name="email"
              type="email"
              inputMode="email"
              value={form.email}
              onChange={handleChange('email')}
              placeholder={t('auth.login.emailPlaceholder')}
              autoComplete="username"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              required
            />
          </div>
          <div className="field">
            <label htmlFor="platformPassword">{t('auth.login.password')}</label>
            <div className="field__control">
              <input
                id="platformPassword"
                name="password"
                type={showPassword ? 'text' : 'password'}
                value={form.password}
                onChange={handleChange('password')}
                placeholder={t('auth.login.passwordPlaceholder')}
                autoComplete="current-password"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                required
              />
              <button
                type="button"
                className="field__reveal"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? t('auth.login.hidePassword') : t('auth.login.showPassword')}
                aria-pressed={showPassword}
                aria-controls="platformPassword"
              >
                {showPassword ? <FiEyeOff aria-hidden="true" /> : <FiEye aria-hidden="true" />}
              </button>
            </div>
          </div>
          <button type="submit" className="btn btn--primary btn--block" disabled={submitting}>
            {submitting ? t('common.loading') : t('platform.login.submit')}
          </button>
        </form>
      </motion.div>
    </div>
  );
}
