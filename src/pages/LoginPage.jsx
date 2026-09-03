import { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { motion } from 'framer-motion';
import { FiShield, FiLock, FiPieChart, FiFileText, FiEye, FiEyeOff } from 'react-icons/fi';
import { useAuth } from '../context/AuthContext.jsx';
import { useLocale } from '../i18n/LocaleContext.jsx';

/* Panel copy fades in top-down; the form card arrives as one piece so the
   inputs never appear to "assemble" under the user's cursor. */
const panelVariants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.09, delayChildren: 0.05 } },
};
const panelItemVariants = {
  hidden: { opacity: 0, y: 16 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.5, ease: [0.22, 1, 0.36, 1] } },
};

const TRUST_POINTS = [
  { icon: FiLock, key: 'auth.login.point.secure' },
  { icon: FiPieChart, key: 'auth.login.point.records' },
  { icon: FiFileText, key: 'auth.login.point.reports' },
];

export default function LoginPage() {
  const { login } = useAuth();
  const { t } = useLocale();
  const navigate = useNavigate();
  const location = useLocation();
  const [form, setForm] = useState({ tenantSlug: '', email: '', password: '' });
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const handleChange = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const session = await login(form);
      // A platform admin's landing page is always /platform, regardless
      // of what page originally redirected them to /login — they may not
      // hold any tenant-scoped permission at all (permissionCatalog.js:
      // platform.manage carries no financial permissions), so honoring
      // location.state.from here could land them on a tenant page with
      // nothing visible on it.
      const destination = session.permissions?.includes('platform.manage')
        ? '/platform'
        : location.state?.from?.pathname ?? '/';
      navigate(destination, { replace: true });
    } catch (err) {
      setError(err.message ?? t('auth.login.error'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="auth-page auth-page--split">
      <div className="auth-split">
        <motion.aside
          className="auth-split__panel"
          variants={panelVariants}
          initial="hidden"
          animate="visible"
        >
          <motion.div className="auth-split__brand" variants={panelItemVariants}>
            <span className="auth-split__brand-mark">
              <FiShield aria-hidden="true" />
            </span>
            {t('app.name')}
          </motion.div>
          <motion.h1 className="auth-split__headline" variants={panelItemVariants}>
            {t('auth.login.headline')}
          </motion.h1>
          <motion.p className="auth-split__lede" variants={panelItemVariants}>
            {t('auth.login.lede')}
          </motion.p>
          <motion.ul className="auth-split__points" variants={panelItemVariants}>
            {TRUST_POINTS.map(({ icon: Icon, key }) => (
              <li className="auth-split__point" key={key}>
                <Icon aria-hidden="true" />
                {t(key)}
              </li>
            ))}
          </motion.ul>
        </motion.aside>

        <div className="auth-split__form">
      <motion.div
        className="auth-card"
        initial={{ opacity: 0, y: 14, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1, transition: { duration: 0.4, delay: 0.12, ease: [0.22, 1, 0.36, 1] } }}
      >
        <div className="auth-card__brand">{t('auth.login.welcome')}</div>
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
            {/* The toggle is positioned inside this wrapper, and the input
                carries matching right padding so typed text never slides
                under the button. */}
            <div className="field__control">
              <input
                id="password"
                type={showPassword ? 'text' : 'password'}
                value={form.password}
                onChange={handleChange('password')}
                autoComplete="current-password"
                required
              />
              <button
                type="button"
                className="field__reveal"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? t('auth.login.hidePassword') : t('auth.login.showPassword')}
                aria-pressed={showPassword}
                tabIndex={-1}
              >
                {showPassword ? <FiEyeOff aria-hidden="true" /> : <FiEye aria-hidden="true" />}
              </button>
            </div>
          </div>
          <motion.button
            type="submit"
            className="btn btn--primary btn--block"
            disabled={submitting}
            whileHover={submitting ? undefined : { y: -1 }}
            whileTap={submitting ? undefined : { scale: 0.985 }}
            transition={{ type: 'spring', stiffness: 400, damping: 28 }}
          >
            {submitting ? t('common.loading') : t('auth.login.submit')}
          </motion.button>
        </form>
      </motion.div>
        </div>
      </div>
    </div>
  );
}
