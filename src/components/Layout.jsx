import { useEffect, useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import {
  FiHome,
  FiDollarSign,
  FiUsers,
  FiCreditCard,
  FiFolder,
  FiTag,
  FiRepeat,
  FiTarget,
  FiClipboard,
  FiCalendar,
  FiBarChart2,
  FiMenu,
  FiX,
  FiLogOut,
  FiUserCheck,
} from 'react-icons/fi';
import { useAuth } from '../context/AuthContext.jsx';
import { useLocale } from '../i18n/LocaleContext.jsx';

// Grouped to match the product's real workflow shape (docs/MASTER_TODO.md
// Phase 10 §10.5), adapted to what actually exists: Income and
// Contributions are one page (contributions.repository already covers
// both), there's no standalone Receipts destination (receipts are
// downloaded from the contribution they belong to — "one receipt
// architecture", not a document library), and Administration only lists
// Users since Roles-editing and Church Settings have no backend module to
// point at yet (building either now would be a screen with nothing real
// behind it, not a genuine feature).
//
// `permission: null` means "always visible to any authenticated user."
// Every other item is hidden unless the caller holds the same permission
// that already gates that page's own API calls — a nav link to a page
// you'd immediately get a 403 from is worse than no link at all.
const NAV_GROUPS = [
  { items: [{ to: '/', icon: FiHome, labelKey: 'nav.dashboard', end: true, permission: null }] },
  {
    labelKey: 'nav.group.transactions',
    items: [
      { to: '/contributions', icon: FiDollarSign, labelKey: 'nav.contributions', permission: 'income.view' },
      { to: '/contributors', icon: FiUsers, labelKey: 'nav.contributors', permission: 'contributors.view' },
      { to: '/expenses', icon: FiCreditCard, labelKey: 'nav.expenses', permission: 'expense.view' },
      { to: '/transfers', icon: FiRepeat, labelKey: 'nav.transfers', permission: 'accounts.view' },
    ],
  },
  {
    labelKey: 'nav.group.finance',
    items: [
      { to: '/accounts', icon: FiFolder, labelKey: 'nav.accounts', permission: 'accounts.view' },
      { to: '/funds', icon: FiFolder, labelKey: 'nav.funds', permission: 'funds.view' },
      // dashboard.view (not a dedicated categories.view) — matches
      // categories.routes.js's own GET permission exactly, which every
      // role holds; categories are reference data every role needs to see
      // in order to use the contribution/expense forms at all.
      { to: '/categories', icon: FiTag, labelKey: 'nav.categories', permission: 'dashboard.view' },
      { to: '/budgets', icon: FiClipboard, labelKey: 'nav.budgets', permission: 'budget.view' },
      { to: '/financial-periods', icon: FiCalendar, labelKey: 'nav.financialPeriods', permission: 'financial_period.view' },
    ],
  },
  {
    labelKey: 'nav.group.pledgesReports',
    items: [
      { to: '/pledges', icon: FiTarget, labelKey: 'nav.pledges', permission: 'pledges.view' },
      { to: '/reports', icon: FiBarChart2, labelKey: 'nav.reports', permission: 'reports.view' },
    ],
  },
  {
    labelKey: 'nav.group.administration',
    items: [{ to: '/users', icon: FiUserCheck, labelKey: 'nav.users', permission: 'users.view' }],
  },
];

export default function Layout() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { session, logout, hasPermission } = useAuth();
  const { t, locale, setLocale } = useLocale();
  const navigate = useNavigate();

  // Mobile slide-in sidebar must not let the page scroll underneath it
  // (docs/MASTER_TODO.md Phase 10 §10.6: "body scroll lock").
  useEffect(() => {
    document.body.style.overflow = sidebarOpen ? 'hidden' : '';
    return () => {
      document.body.style.overflow = '';
    };
  }, [sidebarOpen]);

  const handleLogout = async () => {
    await logout();
    navigate('/login', { replace: true });
  };

  const visibleGroups = NAV_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter((item) => item.permission === null || hasPermission(item.permission)),
  })).filter((group) => group.items.length > 0);

  return (
    <div className="app-shell">
      {sidebarOpen && <div className="app-overlay" onClick={() => setSidebarOpen(false)} />}
      <nav className={`app-sidebar${sidebarOpen ? ' is-open' : ''}`} aria-label="Primary">
        <div className="app-sidebar__brand">
          {t('app.name')}
          <button
            type="button"
            className="app-sidebar__close"
            onClick={() => setSidebarOpen(false)}
            aria-label={t('nav.closeMenu')}
          >
            <FiX aria-hidden="true" />
          </button>
        </div>
        <div className="app-sidebar__nav">
          {visibleGroups.map((group, i) => (
            <div className="app-sidebar__group" key={i}>
              {group.labelKey && <div className="app-sidebar__group-label">{t(group.labelKey)}</div>}
              {group.items.map(({ to, icon: Icon, labelKey, end }) => (
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
            aria-label={t('nav.toggleMenu')}
            aria-expanded={sidebarOpen}
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
