import { useEffect, useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { FiGrid, FiBriefcase, FiMenu, FiX, FiLogOut, FiShield } from 'react-icons/fi';
import { useAuth } from '../context/AuthContext.jsx';
import { useLocale } from '../i18n/LocaleContext.jsx';
import { useMediaQuery } from '../hooks/useMediaQuery.js';
import PageTransition from './ui/PageTransition.jsx';
import ThemeToggle from './ui/ThemeToggle.jsx';

// Deliberately its own small layout, not a reuse of Layout.jsx's markup —
// the platform console has exactly two destinations and no collapse
// state, so duplicating the (much simpler) shell here is clearer than
// threading platform-mode flags through the staff Layout. It reuses 100%
// of the existing app-shell/app-sidebar/app-topbar CSS classes though —
// zero new stylesheet, so it inherits the design system's palette
// automatically, exactly as the staff shell does.
const NAV_ITEMS = [
  { to: '/platform', icon: FiGrid, labelKey: 'platform.nav.dashboard', end: true },
  { to: '/platform/tenants', icon: FiBriefcase, labelKey: 'platform.nav.tenants' },
];

// Mirrors Layout.jsx exactly — right-anchored drawer, spring entry,
// staggered links. See that file for the reasoning on the variant names.
const drawerVariants = {
  hidden: { x: '100%' },
  visible: { x: 0, transition: { type: 'spring', stiffness: 300, damping: 30 } },
  exit: { x: '100%', transition: { duration: 0.2, ease: [0.4, 0, 1, 1] } },
};
const overlayVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { duration: 0.2 } },
  exit: { opacity: 0, transition: { duration: 0.15 } },
};
const navListVariants = {
  navHidden: {},
  navVisible: { transition: { staggerChildren: 0.05, delayChildren: 0.12 } },
};
const navItemVariants = {
  navHidden: { opacity: 0, x: 24 },
  navVisible: { opacity: 1, x: 0, transition: { duration: 0.32, ease: [0.22, 1, 0.36, 1] } },
};

export default function PlatformLayout() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { session, logout } = useAuth();
  const { t, locale, setLocale } = useLocale();
  const navigate = useNavigate();
  const isDesktop = useMediaQuery('(min-width: 900px)');

  useEffect(() => {
    document.body.style.overflow = sidebarOpen && !isDesktop ? 'hidden' : '';
    return () => {
      document.body.style.overflow = '';
    };
  }, [sidebarOpen, isDesktop]);

  useEffect(() => {
    if (!sidebarOpen || isDesktop) return undefined;
    const onKeyDown = (e) => {
      if (e.key === 'Escape') setSidebarOpen(false);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [sidebarOpen, isDesktop]);

  const handleLogout = async () => {
    await logout();
    navigate('/login', { replace: true });
  };

  const sidebarContent = (
    <>
      <div className="app-sidebar__brand">
        <span style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
          <span className="app-sidebar__brand-mark">
            <FiShield aria-hidden="true" />
          </span>
          <span>{t('platform.brand')}</span>
        </span>
        {!isDesktop && (
          <button
            type="button"
            className="app-sidebar__close"
            onClick={() => setSidebarOpen(false)}
            aria-label={t('nav.closeMenu')}
          >
            <FiX aria-hidden="true" />
          </button>
        )}
      </div>
      <motion.div
        className="app-sidebar__nav"
        variants={navListVariants}
        initial="navHidden"
        animate="navVisible"
      >
        <div className="app-sidebar__group">
          {NAV_ITEMS.map(({ to, icon: Icon, labelKey, end }) => (
            <motion.div key={to} variants={navItemVariants}>
              <NavLink
                to={to}
                end={end}
                onClick={() => setSidebarOpen(false)}
                className={({ isActive }) => `app-sidebar__link${isActive ? ' is-active' : ''}`}
              >
                <Icon aria-hidden="true" />
                <span>{t(labelKey)}</span>
              </NavLink>
            </motion.div>
          ))}
        </div>
      </motion.div>
      <div className="app-sidebar__footer">
        <div className="app-sidebar__footer-details">
          <div className="app-sidebar__user">
            <span className="app-sidebar__avatar" aria-hidden="true">
              {(session?.user?.full_name ?? '?').trim().charAt(0).toUpperCase()}
            </span>
            <span className="app-sidebar__user-name">{session?.user?.full_name}</span>
          </div>
          <div className="lang-switch" role="group" aria-label={t('nav.language')}>
            {['en', 'sw'].map((code) => (
              <button
                key={code}
                type="button"
                className={`lang-switch__opt${locale === code ? ' is-active' : ''}`}
                onClick={() => setLocale(code)}
                aria-pressed={locale === code}
              >
                {code.toUpperCase()}
              </button>
            ))}
          </div>
          <button type="button" className="sidebar-ghost-btn" onClick={handleLogout}>
            <FiLogOut aria-hidden="true" /> <span>{t('nav.logout')}</span>
          </button>
        </div>
      </div>
    </>
  );

  return (
    <div className="app-shell">
      {isDesktop ? (
        <nav className="app-sidebar" aria-label="Platform navigation">
          {sidebarContent}
        </nav>
      ) : (
        <AnimatePresence>
          {sidebarOpen && (
            <>
              <motion.div
                className="app-overlay"
                variants={overlayVariants}
                initial="hidden"
                animate="visible"
                exit="exit"
                onClick={() => setSidebarOpen(false)}
              />
              <motion.nav
                className="app-sidebar"
                aria-label="Platform navigation"
                variants={drawerVariants}
                initial="hidden"
                animate="visible"
                exit="exit"
              >
                {sidebarContent}
              </motion.nav>
            </>
          )}
        </AnimatePresence>
      )}

      <div className="app-main">
        <header className="app-topbar">
          <div className="app-topbar__title">
            <span className="app-topbar__mark">C</span>
            <span>{t('platform.brand')}</span>
          </div>
          <div className="app-topbar__actions">
            <ThemeToggle />
            <button
              type="button"
              className="app-topbar__menu-btn"
              onClick={() => setSidebarOpen((v) => !v)}
              aria-label={t('nav.toggleMenu')}
              aria-expanded={sidebarOpen}
            >
              <FiMenu />
            </button>
          </div>
        </header>
        <main className="app-content">
          <PageTransition />
        </main>
      </div>
    </div>
  );
}
