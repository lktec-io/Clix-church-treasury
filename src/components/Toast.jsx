import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { FiCheckCircle, FiAlertTriangle, FiXCircle, FiInfo, FiX } from 'react-icons/fi';

const ToastContext = createContext(null);
const AUTO_DISMISS_MS = 5000;

const ICONS = {
  success: FiCheckCircle,
  error: FiXCircle,
  warning: FiAlertTriangle,
  info: FiInfo,
};

// Slide+fade entrance/exit, ~200ms — "fast + smooth + premium" per the
// motion brief, not a bouncy/playful curve (docs/MASTER_TODO.md premium-UI
// pass §29). AnimatePresence handles the exit animation for the item
// being removed from `toasts`, which a plain CSS keyframe can't do for an
// unmounting element.
const toastVariants = {
  initial: { opacity: 0, y: -12, scale: 0.98 },
  animate: { opacity: 1, y: 0, scale: 1, transition: { duration: 0.2, ease: [0.22, 1, 0.36, 1] } },
  exit: { opacity: 0, x: 24, transition: { duration: 0.15, ease: [0.4, 0, 1, 1] } },
};

// One consistent notification surface for the whole app (docs: Phase 10
// "consistent notification system for success/warning/error/important
// information") — pages call useToast() instead of rolling their own
// transient banner.
export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const nextId = useRef(0);

  const dismiss = useCallback((id) => {
    setToasts((list) => list.filter((item) => item.id !== id));
  }, []);

  const push = useCallback(
    (tone, message) => {
      const id = nextId.current++;
      setToasts((list) => [...list, { id, tone, message }]);
      setTimeout(() => dismiss(id), AUTO_DISMISS_MS);
      return id;
    },
    [dismiss]
  );

  const api = useMemo(
    () => ({
      success: (message) => push('success', message),
      error: (message) => push('error', message),
      warning: (message) => push('warning', message),
      info: (message) => push('info', message),
    }),
    [push]
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="toast-stack" role="region" aria-label="Notifications">
        <AnimatePresence initial={false}>
          {toasts.map(({ id, tone, message }) => {
            const Icon = ICONS[tone];
            return (
              <motion.div
                key={id}
                layout
                variants={toastVariants}
                initial="initial"
                animate="animate"
                exit="exit"
                className={`toast toast--${tone}`}
                role="status"
                aria-live="polite"
              >
                <Icon aria-hidden="true" className="toast__icon" />
                <div className="toast__message">{message}</div>
                <button type="button" className="toast__close" onClick={() => dismiss(id)} aria-label="Dismiss">
                  <FiX aria-hidden="true" />
                </button>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within a ToastProvider');
  return ctx;
}
