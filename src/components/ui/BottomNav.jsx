import { NavLink } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useAuth } from '../../context/AuthContext.jsx';
import { useLocale } from '../../i18n/LocaleContext.jsx';

// App-style shortcut dock, mobile only (hidden at >=900px by layout.css,
// where the sidebar is always visible and a second nav would be noise).
//
// Items are permission-filtered against the SAME hasPermission the sidebar
// uses, so this can never offer a shortcut to a page the user would be
// bounced out of. A user who can see none of them gets no dock at all
// rather than an empty bar.
export default function BottomNav({ items }) {
  const { hasPermission } = useAuth();
  const { t } = useLocale();

  const visible = items.filter((item) => item.permission === null || hasPermission(item.permission));
  if (visible.length === 0) return null;

  return (
    <nav className="bottom-nav" aria-label={t('nav.quickAccess')}>
      {visible.map(({ to, icon: Icon, labelKey, end }) => (
        <NavLink
          key={to}
          to={to}
          end={end}
          className={({ isActive }) => `bottom-nav__item${isActive ? ' is-active' : ''}`}
        >
          {({ isActive }) => (
            <>
              {/* Shared layoutId: the green pill physically travels between
                  tabs rather than cross-fading, which is what makes the
                  switch feel like one object moving. */}
              {isActive && (
                <motion.span
                  className="bottom-nav__pill"
                  layoutId="bottomNavPill"
                  transition={{ type: 'spring', stiffness: 380, damping: 30 }}
                />
              )}
              <span className="bottom-nav__icon">
                <Icon aria-hidden="true" />
              </span>
              <span className="bottom-nav__label">{t(labelKey)}</span>
            </>
          )}
        </NavLink>
      ))}
    </nav>
  );
}
