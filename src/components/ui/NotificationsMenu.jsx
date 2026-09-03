import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { FiBell, FiInbox } from 'react-icons/fi';
import { useLocale } from '../../i18n/LocaleContext.jsx';

// Notifications control.
//
// IMPORTANT: there is no notification source in this product yet — no table,
// no endpoint, no service. So this renders a real, working panel with a
// truthful empty state rather than inventing items or an unread count. When
// a backend feed exists, replace the empty `items` array below with it; the
// panel already renders a list, and the badge already keys off length, so
// nothing else here has to change.
const items = [];

const panelVariants = {
  hidden: { opacity: 0, y: -8, scale: 0.97 },
  visible: { opacity: 1, y: 0, scale: 1, transition: { duration: 0.18, ease: [0.22, 1, 0.36, 1] } },
  exit: { opacity: 0, y: -6, scale: 0.98, transition: { duration: 0.12 } },
};

export default function NotificationsMenu() {
  const [open, setOpen] = useState(false);
  const { t } = useLocale();
  const wrapRef = useRef(null);

  // Close on outside click and on Escape — the two things a dropdown must
  // handle to not feel broken.
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

  return (
    <div className="topbar-menu" ref={wrapRef}>
      <button
        type="button"
        className="topbar-btn"
        onClick={() => setOpen((v) => !v)}
        aria-label={t('nav.notifications')}
        title={t('nav.notifications')}
        aria-expanded={open}
        aria-haspopup="true"
      >
        <FiBell aria-hidden="true" />
        {items.length > 0 && <span className="topbar-btn__badge">{items.length}</span>}
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            className="topbar-panel"
            role="menu"
            variants={panelVariants}
            initial="hidden"
            animate="visible"
            exit="exit"
          >
            <div className="topbar-panel__header">{t('nav.notifications')}</div>
            {items.length === 0 ? (
              <div className="topbar-panel__empty">
                <FiInbox aria-hidden="true" />
                <span>{t('nav.notifications.empty')}</span>
              </div>
            ) : null}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
