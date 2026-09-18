import { useEffect, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
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
  FiSend,
  FiMenu,
  FiX,
  FiUserCheck,
  FiUpload,
  FiBookOpen,
  FiChevronsLeft,
  FiChevronsRight,
  FiChevronDown,
  FiSettings,
} from 'react-icons/fi';
import { useAuth } from '../context/AuthContext.jsx';
import { useLocale } from '../i18n/LocaleContext.jsx';
import { useMediaQuery } from '../hooks/useMediaQuery.js';
import PageTransition from './ui/PageTransition.jsx';
import NotificationsMenu from './ui/NotificationsMenu.jsx';
import SystemStatus from './ui/SystemStatus.jsx';
import ProfileMenu from './ui/ProfileMenu.jsx';
import BottomNav from './ui/BottomNav.jsx';

// The five things a church treasurer does every week sit at the top level.
// Everything else (accounts, funds, periods, reports, users …) still exists
// and is still needed occasionally — recording income requires an open
// financial period and a category — so it lives in one collapsible
// "Treasury setup" group instead of being deleted.
//
// `permission: null` means "always visible to any authenticated user."
// Every other item is hidden unless the caller holds the same permission
// that already gates that page's own API calls — a nav link to a page
// you'd immediately get a 403 from is worse than no link at all.
const PRIMARY_NAV = [
  { to: '/', icon: FiHome, labelKey: 'nav.dashboard', end: true, permission: null },
  { to: '/contributions', icon: FiDollarSign, labelKey: 'nav.contributions', permission: 'income.view' },
  { to: '/expenses', icon: FiCreditCard, labelKey: 'nav.expenses', permission: 'expense.view' },
  { to: '/pledges', icon: FiTarget, labelKey: 'nav.pledges', permission: 'pledges.view' },
  { to: '/contributors', icon: FiUsers, labelKey: 'nav.contributors', permission: 'contributors.view' },
];

const SETUP_NAV = [
  { to: '/transfers', icon: FiRepeat, labelKey: 'nav.transfers', permission: 'accounts.view' },
  { to: '/accounts', icon: FiFolder, labelKey: 'nav.accounts', permission: 'accounts.view' },
  { to: '/funds', icon: FiFolder, labelKey: 'nav.funds', permission: 'funds.view' },
  // dashboard.view matches categories.routes.js's own GET permission, which
  // every role holds: the income and expense forms need categories.
  { to: '/categories', icon: FiTag, labelKey: 'nav.categories', permission: 'dashboard.view' },
  { to: '/budgets', icon: FiClipboard, labelKey: 'nav.budgets', permission: 'budget.view' },
  { to: '/financial-periods', icon: FiCalendar, labelKey: 'nav.financialPeriods', permission: 'financial_period.view' },
  { to: '/treasury/remittance', icon: FiUpload, labelKey: 'nav.remittance', permission: 'remittance.view' },
  { to: '/reports', icon: FiBarChart2, labelKey: 'nav.reports', permission: 'reports.view' },
  { to: '/reports/trial-balance', icon: FiBookOpen, labelKey: 'nav.trialBalance', permission: 'reports.view' },
  { to: '/member-statements', icon: FiSend, labelKey: 'nav.memberStatements', permission: 'contributors.view' },
  { to: '/users', icon: FiUserCheck, labelKey: 'nav.users', permission: 'users.view' },
];

// Mobile dock: the same five destinations as the sidebar's top level.
const QUICK_NAV = PRIMARY_NAV;

const SIDEBAR_WIDTH = 240;
const SIDEBAR_WIDTH_COLLAPSED = 76;
const COLLAPSE_STORAGE_KEY = 'clix.sidebarCollapsed';

// Slides in from the LEFT edge (-100%) to match the left-anchored drawer in
// Sidebar.css. Spring rather than a fixed duration so it settles with weight
// instead of arriving linearly.
const drawerVariants = {
  hidden: { x: '-100%', opacity: 0 },
  visible: {
    x: 0,
    opacity: 1,
    transition: { type: 'spring', stiffness: 300, damping: 30, opacity: { duration: 0.18 } },
  },
  exit: { x: '-100%', opacity: 0, transition: { duration: 0.2, ease: [0.4, 0, 1, 1] } },
};
const overlayVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { duration: 0.2 } },
  exit: { opacity: 0, transition: { duration: 0.15 } },
};

// Nav links cascade in behind the drawer. Own variant names (not
// hidden/visible) so these never collide with the drawer's variants via
// Framer's parent→child propagation. Links slide RIGHT into place, i.e.
// from the left edge they entered from.
const navListVariants = {
  navHidden: {},
  navVisible: { transition: { staggerChildren: 0.05, delayChildren: 0.12 } },
};
const navItemVariants = {
  navHidden: { opacity: 0, x: -24 },
  navVisible: { opacity: 1, x: 0, transition: { duration: 0.32, ease: [0.22, 1, 0.36, 1] } },
};

export default function Layout() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(COLLAPSE_STORAGE_KEY) === '1';
    } catch {
      return false;
    }
  });
  const { hasPermission } = useAuth();
  const { t } = useLocale();
  const location = useLocation();
  const isDesktop = useMediaQuery('(min-width: 900px)');
  const canSee = (item) => item.permission === null || hasPermission(item.permission);
  const primaryItems = PRIMARY_NAV.filter(canSee);
  const setupItems = SETUP_NAV.filter(canSee);
  // The setup group opens itself when you are on one of its pages, so the
  // active link is never hidden inside a closed group.
  const onSetupPage = setupItems.some((item) => location.pathname.startsWith(item.to));
  const [setupOpen, setSetupOpen] = useState(onSetupPage);
  const setupExpanded = setupOpen || onSetupPage;

  // Mobile slide-in sidebar must not let the page scroll underneath it
  // (docs/MASTER_TODO.md Phase 10 §10.6: "body scroll lock").
  useEffect(() => {
    document.body.style.overflow = sidebarOpen && !isDesktop ? 'hidden' : '';
    return () => {
      document.body.style.overflow = '';
    };
  }, [sidebarOpen, isDesktop]);

  // Escape closes the mobile drawer, same as clicking the backdrop.
  useEffect(() => {
    if (!sidebarOpen || isDesktop) return undefined;
    const onKeyDown = (e) => {
      if (e.key === 'Escape') setSidebarOpen(false);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [sidebarOpen, isDesktop]);

  const toggleCollapsed = () => {
    setCollapsed((v) => {
      const next = !v;
      try {
        localStorage.setItem(COLLAPSE_STORAGE_KEY, next ? '1' : '0');
      } catch {
        // Non-fatal — collapse state just won't persist across reloads.
      }
      return next;
    });
  };

  const isCollapsedDesktop = isDesktop && collapsed;

  const renderLink = ({ to, icon: Icon, labelKey, end }, nested = false) => (
    <motion.div key={to} variants={navItemVariants}>
      <NavLink
        to={to}
        end={end}
        title={isCollapsedDesktop ? t(labelKey) : undefined}
        onClick={() => setSidebarOpen(false)}
        className={({ isActive }) => `app-sidebar__link${nested ? ' app-sidebar__link--nested' : ''}${isActive ? ' is-active' : ''}`}
      >
        <Icon aria-hidden="true" />
        <span>{t(labelKey)}</span>
      </NavLink>
    </motion.div>
  );

  const sidebarContent = (
    <>
      <div className="app-sidebar__brand">
        <span className="app-sidebar__brand-text">
          <span className="app-sidebar__brand-mark">C</span>
          <span>{t('app.name')}</span>
        </span>
        {isDesktop ? (
          <button
            type="button"
            className="app-sidebar__collapse-btn"
            onClick={toggleCollapsed}
            aria-label={collapsed ? t('nav.expandMenu') : t('nav.collapseMenu')}
          >
            {collapsed ? <FiChevronsRight aria-hidden="true" /> : <FiChevronsLeft aria-hidden="true" />}
          </button>
        ) : (
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
          {primaryItems.map((item) => renderLink(item))}
        </div>
        {setupItems.length > 0 && (
          <div className="app-sidebar__group">
            <motion.div variants={navItemVariants}>
              <button
                type="button"
                className={`app-sidebar__group-toggle${setupExpanded ? ' is-open' : ''}`}
                onClick={() => setSetupOpen((v) => !v)}
                aria-expanded={setupExpanded}
                title={isCollapsedDesktop ? t('nav.group.setup') : undefined}
              >
                <FiSettings aria-hidden="true" />
                <span>{t('nav.group.setup')}</span>
                <FiChevronDown className="app-sidebar__group-caret" aria-hidden="true" />
              </button>
            </motion.div>
            {setupExpanded && setupItems.map((item) => renderLink(item, true))}
          </div>
        )}
      </motion.div>
    </>
  );

  return (
    <div className="app-shell">
      {isDesktop ? (
        <motion.nav
          className={`app-sidebar${collapsed ? ' is-collapsed' : ''}`}
          aria-label="Primary"
          animate={{ width: collapsed ? SIDEBAR_WIDTH_COLLAPSED : SIDEBAR_WIDTH }}
          transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
        >
          {sidebarContent}
        </motion.nav>
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
                aria-label="Primary"
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
            <span>{t('app.name')}</span>
          </div>
          <div className="app-topbar__actions">
            {/* Live network + API reachability, so a treasurer knows before
                pressing Save whether the entry can reach the server. */}
            <SystemStatus />
            <NotificationsMenu />
            <ProfileMenu />
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

      <BottomNav items={QUICK_NAV} />
    </div>
  );
}
