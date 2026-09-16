import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { FiChevronDown, FiLogOut, FiGlobe } from 'react-icons/fi';
import { useAuth } from '../../context/AuthContext.jsx';
import { useLocale } from '../../i18n/LocaleContext.jsx';

// Logged-in treasurer's profile control in the global header: identity,
// roles, language and sign-out in one place, reachable on every page.
//
// There is no "switch to another treasurer" action by design. A session
// belongs to one person, and every financial action is audit-logged against
// that person's user id — letting a second person operate inside someone
// else's session would put their actions under the wrong name. Changing
// user means signing out and signing in, which is what this offers.
const panelVariants = {
  hidden: { opacity: 0, y: -6 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.16, ease: [0.22, 1, 0.36, 1] } },
  exit: { opacity: 0, y: -4, transition: { duration: 0.1 } },
};

export default function ProfileMenu() {
  const { session, logout } = useAuth();
  const { t, locale, setLocale } = useLocale();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (e) => {
      if (!wrapRef.current?.contains(e.target)) setOpen(false);
    };
    const onKeyDown = (e) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const name = session?.user?.full_name ?? '';
  const initial = name.trim().charAt(0).toUpperCase() || '?';
  const roles = session?.roles ?? [];

  const handleLogout = async () => {
    setOpen(false);
    await logout();
    navigate('/login', { replace: true });
  };

  return (
    <div className="topbar-menu profile-menu" ref={wrapRef}>
      <button
        type="button"
        className="profile-menu__trigger"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="true"
        aria-label={t('profile.menu')}
      >
        <span className="profile-menu__avatar" aria-hidden="true">{initial}</span>
        <span className="profile-menu__identity">
          <span className="profile-menu__name">{name}</span>
          {roles[0] && <span className="profile-menu__role">{roles[0]}</span>}
        </span>
        <FiChevronDown className="profile-menu__caret" aria-hidden="true" />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div className="topbar-panel profile-menu__panel" role="menu" variants={panelVariants} initial="hidden" animate="visible" exit="exit">
            <div className="profile-menu__header">
              <div className="profile-menu__header-name">{name}</div>
              {session?.user?.email && <div className="profile-menu__header-email">{session.user.email}</div>}
              {roles.length > 0 && (
                <div className="profile-menu__roles">
                  {roles.map((role) => (
                    <span key={role} className="badge badge--neutral">{role}</span>
                  ))}
                </div>
              )}
            </div>

            <div className="profile-menu__row">
              <span className="profile-menu__row-label">
                <FiGlobe aria-hidden="true" /> {t('nav.language')}
              </span>
              <div className="seg-switch" role="group" aria-label={t('nav.language')}>
                {['sw', 'en'].map((code) => (
                  <button
                    key={code}
                    type="button"
                    className={`seg-switch__opt${locale === code ? ' is-active' : ''}`}
                    onClick={() => setLocale(code)}
                    aria-pressed={locale === code}
                  >
                    {code.toUpperCase()}
                  </button>
                ))}
              </div>
            </div>

            <button type="button" className="profile-menu__logout" role="menuitem" onClick={handleLogout}>
              <FiLogOut aria-hidden="true" /> {t('nav.logout')}
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
