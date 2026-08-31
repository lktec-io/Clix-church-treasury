import { useEffect, useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { FiGrid, FiBriefcase, FiMenu, FiX, FiLogOut, FiShield } from 'react-icons/fi';
import { useAuth } from '../context/AuthContext.jsx';
import { useLocale } from '../i18n/LocaleContext.jsx';
import { useMediaQuery } from '../hooks/useMediaQuery.js';
import PageTransition from './ui/PageTransition.jsx';
import ThemeSwitcher from './ui/ThemeSwitcher.jsx';

// Deliberately its own small layout, not a reuse of Layout.jsx's markup —
// the platform console has exactly two destinations and no collapse
// state, so duplicating the (much simpler) shell here is clearer than
// threading platform-mode flags through the staff Layout. It reuses 100%
// of the existing app-shell/app-sidebar/app-topbar CSS classes though —
// zero new stylesheet, so every theme (Aurora/Midnight/Frost) already
// works here exactly as it does for the staff shell.
const NAV_ITEMS = [
  { to: '/platform', icon: FiGrid, labelKey: 'platform.nav.dashboard', end: true },
  { to: '/platform/tenants', icon: FiBriefcase, labelKey: 'platform.nav.tenants' },
];

const drawerVariants = {
  hidden: { x: '-100%' },
  visible: { x: 0, transition: { duration: 0.28, ease: [0.22, 1, 0.36, 1] } },
  exit: { x: '-100%', transition: { duration: 0.22, ease: [0.4, 0, 1, 1] } },
};
const overlayVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { duration: 0.2 } },
  exit: { opacity: 0, transition: { duration: 0.15 } },
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
      <div className="app-sidebar__nav">
        <div className="app-sidebar__group">
          {NAV_ITEMS.map(({ to, icon: Icon, labelKey, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              onClick={() => setSidebarOpen(false)}
              className={({ isActive }) => `app-sidebar__link${isActive ? ' is-active' : ''}`}
            >
              <Icon aria-hidden="true" />
              <span>{t(labelKey)}</span>
            </NavLink>
          ))}
        </div>
      </div>
      <div className="app-sidebar__footer">
        <div className="app-sidebar__footer-details">
          <div>{session?.user?.full_name}</div>
          <div style={{ marginTop: 10 }}>
            <ThemeSwitcher />
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <select
              value={locale}
              onChange={(e) => setLocale(e.target.value)}
              aria-label="Language"
              style={{ fontSize: 12, padding: '2px 4px' }}
            >
              <option value="en">EN</option>
              <option value="sw">SW</option>
            </select>
            <button type="button" className="btn btn--secondary btn--sm" onClick={handleLogout}>
              <FiLogOut aria-hidden="true" /> {t('nav.logout')}
            </button>
          </div>
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
          <button
            type="button"
            className="app-topbar__menu-btn"
            onClick={() => setSidebarOpen((v) => !v)}
            aria-label={t('nav.toggleMenu')}
            aria-expanded={sidebarOpen}
          >
            <FiMenu />
          </button>
          <div className="app-topbar__title">{t('platform.brand')}</div>
        </header>
        <main className="app-content">
          <PageTransition />
        </main>
      </div>
    </div>
  );
}
