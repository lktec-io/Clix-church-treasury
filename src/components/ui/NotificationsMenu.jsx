import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { FiBell, FiInbox, FiDollarSign, FiCreditCard, FiUserPlus, FiSend, FiActivity } from 'react-icons/fi';
import { useLocale } from '../../i18n/LocaleContext.jsx';
import { useActivity } from '../../context/ActivityContext.jsx';

// Notifications control, backed by the in-session activity feed
// (context/ActivityContext.jsx).
//
// SCOPE: the feed is this tab, this session — see that file's header for
// why it is deliberately not persisted. The badge counts what the user has
// not opened the panel to look at, so opening it clears the count.
const KIND_ICONS = {
  contribution: FiDollarSign,
  expense: FiCreditCard,
  member: FiUserPlus,
  sms: FiSend,
  general: FiActivity,
};

const panelVariants = {
  hidden: { opacity: 0, y: -8, scale: 0.97 },
  visible: { opacity: 1, y: 0, scale: 1, transition: { duration: 0.18, ease: [0.22, 1, 0.36, 1] } },
  exit: { opacity: 0, y: -6, scale: 0.98, transition: { duration: 0.12 } },
};

// The badge lands with an overshoot rather than fading in, so a count that
// ticks up while the user is looking elsewhere still registers peripherally.
const badgeVariants = {
  hidden: { scale: 0, opacity: 0 },
  visible: { scale: 1, opacity: 1, transition: { type: 'spring', stiffness: 520, damping: 16 } },
  exit: { scale: 0, opacity: 0, transition: { duration: 0.14 } },
};

function timeOf(date, locale) {
  try {
    return date.toLocaleTimeString(locale === 'sw' ? 'sw-TZ' : undefined, { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}

export default function NotificationsMenu() {
  const [open, setOpen] = useState(false);
  const { t, locale } = useLocale();
  const { events, unseen, markAllSeen } = useActivity();
  const wrapRef = useRef(null);
  // Re-keys the badge on every increment so Framer replays the spring —
  // animating only on mount would pop once and then sit still as the number
  // climbed from 1 to 2 to 3.
  const [pulseKey, setPulseKey] = useState(0);
  const lastUnseen = useRef(unseen);

  useEffect(() => {
    if (unseen > lastUnseen.current) setPulseKey((k) => k + 1);
    lastUnseen.current = unseen;
  }, [unseen]);

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

  const toggle = () => {
    setOpen((wasOpen) => {
      // Opening is what marks the feed as seen.
      if (!wasOpen) markAllSeen();
      return !wasOpen;
    });
  };

  return (
    <div className="topbar-menu" ref={wrapRef}>
      <button
        type="button"
        className="topbar-btn"
        onClick={toggle}
        aria-label={
          unseen > 0 ? `${t('nav.notifications')} (${unseen})` : t('nav.notifications')
        }
        title={t('nav.notifications')}
        aria-expanded={open}
        aria-haspopup="true"
      >
        {/* The bell itself nudges when the count rises, so the motion reads
            as the icon reacting rather than a dot appearing beside it. */}
        <motion.span
          key={`bell-${pulseKey}`}
          className="topbar-btn__bell"
          animate={pulseKey > 0 ? { rotate: [0, -14, 11, -7, 0] } : undefined}
          transition={{ duration: 0.55, ease: 'easeInOut' }}
        >
          <FiBell aria-hidden="true" />
        </motion.span>

        <AnimatePresence>
          {unseen > 0 && (
            <motion.span
              key={`badge-${pulseKey}`}
              className="topbar-btn__badge"
              variants={badgeVariants}
              initial="hidden"
              animate="visible"
              exit="exit"
            >
              {unseen > 9 ? '9+' : unseen}
            </motion.span>
          )}
        </AnimatePresence>
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
            {events.length === 0 ? (
              <div className="topbar-panel__empty">
                <FiInbox aria-hidden="true" />
                <span>{t('nav.notifications.empty')}</span>
              </div>
            ) : (
              <ul className="topbar-panel__list">
                {events.map((event) => {
                  const Icon = KIND_ICONS[event.kind] ?? KIND_ICONS.general;
                  return (
                    <li key={event.id} className="topbar-panel__item">
                      <span className="topbar-panel__item-icon">
                        <Icon aria-hidden="true" />
                      </span>
                      <span className="topbar-panel__item-text">{event.message}</span>
                      <span className="topbar-panel__item-time tabular-nums">{timeOf(event.at, locale)}</span>
                    </li>
                  );
                })}
              </ul>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
