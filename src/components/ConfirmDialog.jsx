import { createContext, useCallback, useContext, useRef, useState, useEffect } from 'react';
import { useLocale } from '../i18n/LocaleContext.jsx';

const ConfirmContext = createContext(null);

// Promise-based confirmation modal shared by every destructive/irreversible
// action (docs: Phase 10 "confirmation dialogs must explain the action
// clearly") — replaces window.confirm/window.prompt, which are functional
// but not something a commercial product ships with. `requireReason: true`
// adds a textarea and disables the confirm button until non-empty (used by
// reject/reverse/reopen, which already require a reason server-side).
export function ConfirmProvider({ children }) {
  const { t } = useLocale();
  const [request, setRequest] = useState(null);
  const [reason, setReason] = useState('');
  const resolverRef = useRef(null);
  const confirmButtonRef = useRef(null);
  const dialogRef = useRef(null);

  const confirm = useCallback((options) => {
    setReason('');
    setRequest(options);
    return new Promise((resolve) => {
      resolverRef.current = resolve;
    });
  }, []);

  const settle = useCallback((value) => {
    setRequest(null);
    resolverRef.current?.(value);
    resolverRef.current = null;
  }, []);

  const handleConfirm = () => {
    if (request?.requireReason) {
      settle({ confirmed: true, reason });
    } else {
      settle(true);
    }
  };

  const handleCancel = () => settle(request?.requireReason ? { confirmed: false, reason: '' } : false);

  useEffect(() => {
    if (!request) return undefined;
    confirmButtonRef.current?.focus();

    const onKeyDown = (e) => {
      if (e.key === 'Escape') {
        handleCancel();
      } else if (e.key === 'Tab') {
        // Minimal focus trap — the dialog only ever contains a handful of
        // focusable elements, so cycling between the first and last is enough.
        const focusable = dialogRef.current?.querySelectorAll('button, textarea');
        if (!focusable || focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request]);

  const confirmDisabled = request?.requireReason && reason.trim().length === 0;

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {request && (
        <div className="modal-overlay" onMouseDown={handleCancel}>
          <div
            className="modal"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="confirm-dialog-title"
            ref={dialogRef}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <h2 id="confirm-dialog-title">{request.title}</h2>
            {request.message && <p className="modal__message">{request.message}</p>}
            {request.requireReason && (
              <div className="field">
                <label htmlFor="confirm-reason">{t('common.reason')}</label>
                <textarea
                  id="confirm-reason"
                  rows={3}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  autoFocus
                />
              </div>
            )}
            <div className="modal__actions">
              <button type="button" className="btn btn--secondary" onClick={handleCancel}>
                {t('common.cancel')}
              </button>
              <button
                type="button"
                ref={confirmButtonRef}
                className={`btn ${request.tone === 'danger' ? 'btn--danger' : 'btn--primary'}`}
                onClick={handleConfirm}
                disabled={confirmDisabled}
              >
                {request.confirmLabel ?? t('common.confirm')}
              </button>
            </div>
          </div>
        </div>
      )}
    </ConfirmContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useConfirm() {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error('useConfirm must be used within a ConfirmProvider');
  return ctx;
}
