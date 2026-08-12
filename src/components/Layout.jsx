import { useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import {
  FiHome,
  FiDollarSign,
  FiUsers,
  FiCreditCard,
  FiFolder,
  FiRepeat,
  FiMenu,
  FiLogOut,
} from 'react-icons/fi';
import { useAuth } from '../context/AuthContext.jsx';
import { useLocale } from '../i18n/LocaleContext.jsx';

const NAV_ITEMS = [
  { to: '/', icon: FiHome, labelKey: 'nav.dashboard', end: true },
  { to: '/contributions', icon: FiDollarSign, labelKey: 'nav.contributions' },
  { to: '/contributors', icon: FiUsers, labelKey: 'nav.contributors' },
  { to: '/expenses', icon: FiCreditCard, labelKey: 'nav.expenses' },
  { to: '/accounts', icon: FiFolder, labelKey: 'nav.accounts' },
  { to: '/funds', icon: FiFolder, labelKey: 'nav.funds' },
  { to: '/transfers', icon: FiRepeat, labelKey: 'nav.transfers' },
];

export default function Layout() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { session, logout } = useAuth();
  const { t, locale, setLocale } = useLocale();
  const navigate = useNavigate();

  const handleLogout = async () => {
    await logout();
    navigate('/login', { replace: true });
  };

  return (
    <div className="app-shell">
      {sidebarOpen && <div className="app-overlay" onClick={() => setSidebarOpen(false)} />}
      <nav className={`app-sidebar${sidebarOpen ? ' is-open' : ''}`} aria-label="Primary">
        <div className="app-sidebar__brand">{t('app.name')}</div>
        <div className="app-sidebar__nav">
          {NAV_ITEMS.map(({ to, icon: Icon, labelKey, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              onClick={() => setSidebarOpen(false)}
              className={({ isActive }) => `app-sidebar__link${isActive ? ' is-active' : ''}`}
            >
              <Icon aria-hidden="true" />
              {t(labelKey)}
            </NavLink>
          ))}
        </div>
        <div className="app-sidebar__footer">
          <div>{session?.user?.full_name}</div>
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
      </nav>

      <div className="app-main">
        <header className="app-topbar">
          <button
            type="button"
            className="app-topbar__menu-btn"
            onClick={() => setSidebarOpen((v) => !v)}
            aria-label="Toggle navigation"
          >
            <FiMenu />
          </button>
          <div className="app-topbar__title">{t('app.name')}</div>
        </header>
        <main className="app-content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
