import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import { FiCheckCircle, FiAlertTriangle, FiXCircle, FiInfo, FiX } from 'react-icons/fi';

const ToastContext = createContext(null);
const AUTO_DISMISS_MS = 5000;

const ICONS = {
  success: FiCheckCircle,
  error: FiXCircle,
  warning: FiAlertTriangle,
  info: FiInfo,
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
        {toasts.map(({ id, tone, message }) => {
          const Icon = ICONS[tone];
          return (
            <div key={id} className={`toast toast--${tone}`} role="status" aria-live="polite">
              <Icon aria-hidden="true" className="toast__icon" />
              <div className="toast__message">{message}</div>
              <button type="button" className="toast__close" onClick={() => dismiss(id)} aria-label="Dismiss">
                <FiX aria-hidden="true" />
              </button>
            </div>
          );
        })}
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
