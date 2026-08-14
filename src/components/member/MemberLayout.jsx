import { NavLink, useNavigate, useLocation } from 'react-router-dom';
import { FiHome, FiClock, FiFileText, FiLock, FiLogOut, FiHeart } from 'react-icons/fi';
import { useMemberAuth } from '../../context/MemberAuthContext.jsx';
import { useLocale } from '../../i18n/LocaleContext.jsx';
import PageTransition from '../ui/PageTransition.jsx';

// Deliberately much simpler than the staff Layout.jsx — no multi-group
// sidebar, since a member only ever needs four destinations. Bottom tab
// bar on mobile (where members will actually use this, per the product
// spec's "mobile-first" requirement), reusing the same CSS custom
// properties and ~900px breakpoint convention already established in
// App.css/index.css rather than introducing a second design system.
const NAV_ITEMS = [
  { to: '/member/dashboard', icon: FiHome, labelKey: 'member.nav.dashboard', end: true },
  { to: '/member/history', icon: FiClock, labelKey: 'member.nav.history' },
  { to: '/member/statement', icon: FiFileText, labelKey: 'member.nav.statement' },
  { to: '/member/change-pin', icon: FiLock, labelKey: 'member.nav.changePin' },
];

export default function MemberLayout() {
  const { session, logout } = useMemberAuth();
  const { t, locale, setLocale } = useLocale();
  const navigate = useNavigate();
  const location = useLocation();

  const handleLogout = async () => {
    await logout();
    navigate('/member', { replace: true });
  };

  return (
    <div className="member-shell">
      <header className="member-topbar">
        <div className="member-topbar__title">
          <FiHeart aria-hidden="true" />
          {t('app.name')}
        </div>
        <div className="member-topbar__actions">
          <select
            value={locale}
            onChange={(e) => setLocale(e.target.value)}
            aria-label={t('member.language')}
            className="member-topbar__locale"
          >
            <option value="en">EN</option>
            <option value="sw">SW</option>
          </select>
          <button type="button" className="btn btn--secondary btn--sm" onClick={handleLogout}>
            <FiLogOut aria-hidden="true" /> {t('nav.logout')}
          </button>
        </div>
      </header>

      {session?.contributor && location.pathname === '/member/dashboard' && (
        <div className="member-greeting">{t('member.greeting', { name: session.contributor.full_name.split(' ')[0] })}</div>
      )}

      <main className="member-content">
        <PageTransition />
      </main>

      <nav className="member-tabbar" aria-label={t('member.nav.label')}>
        {NAV_ITEMS.map(({ to, icon: Icon, labelKey, end }) => (
          <NavLink key={to} to={to} end={end} className={({ isActive }) => `member-tabbar__link${isActive ? ' is-active' : ''}`}>
            <Icon aria-hidden="true" />
            <span>{t(labelKey)}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
