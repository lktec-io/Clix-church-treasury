import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { FiCheck, FiAlertTriangle, FiInfo, FiRefreshCw, FiX } from 'react-icons/fi';
import { useLocale } from '../../i18n/LocaleContext.jsx';

// Centred SMS-propagation dialog, shown at the moment a contribution's
// confirmation (or a manual resend) is dispatched.
//
// IMPORTANT — what is and isn't real here, same contract as the inline
// SmsDispatchIndicator this shares its logic with:
//
// The 1% → 100% ticker is a PRESENTATION of work already finished. The
// server sends the SMS synchronously and the outcome is in the response
// before this ever mounts; there is no progress to stream, and Beem exposes
// no delivery-receipt webhook this app subscribes to. The ticker gives the
// eye something to follow during a moment that would otherwise snap.
//
// The OUTCOME is never simulated. The green tick renders only when the
// server actually reported status === 'sent'; a failure resolves into the
// failure state with its real reason and a retry action. Showing a tick for
// an SMS that never arrived would tell a clerk a member has their receipt
// when they do not — the one thing this must never do.
const DISPATCH_MS = 1500;

function prefersReducedMotion() {
  return typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

const overlayVariants = {
  initial: { opacity: 0 },
  animate: { opacity: 1, transition: { duration: 0.2 } },
  exit: { opacity: 0, transition: { duration: 0.16 } },
};

const popVariants = {
  initial: { opacity: 0, scale: 0.92, y: 14 },
  animate: { opacity: 1, scale: 1, y: 0, transition: { type: 'spring', stiffness: 320, damping: 26 } },
  exit: { opacity: 0, scale: 0.96, y: 8, transition: { duration: 0.16 } },
};

// The "satisfying bounce": an underdamped spring that overshoots slightly
// before settling, rather than easing flatly into place.
const tickVariants = {
  hidden: { scale: 0, rotate: -35, opacity: 0 },
  visible: {
    scale: 1,
    rotate: 0,
    opacity: 1,
    transition: { type: 'spring', stiffness: 340, damping: 12, mass: 0.9 },
  },
};

const ringVariants = {
  hidden: { scale: 0.7, opacity: 0 },
  visible: { scale: 1, opacity: 1, transition: { type: 'spring', stiffness: 260, damping: 18 } },
};

/**
 * `dispatch` is { dispatchId, status, reasonCode, reason, preview } or null.
 * The caller bumps dispatchId on every send so a resend replays the sequence;
 * this component is mounted with key={dispatchId} for the same reason.
 */
export default function SmsPopCenter({ dispatch, onClose, onRetry, retrying = false }) {
  const { t } = useLocale();
  const reduced = prefersReducedMotion();
  // Reduced motion skips straight to the outcome: an unprompted 1.5s
  // animation is precisely what that setting asks us not to play.
  const [phase, setPhase] = useState(() => (reduced ? 'done' : 'dispatching'));
  const [progress, setProgress] = useState(() => (reduced ? 100 : 1));
  const frameRef = useRef(null);
  const closeRef = useRef(null);

  useEffect(() => {
    if (reduced) return undefined;
    const start = performance.now();

    // requestAnimationFrame, not setInterval: the percentage is rendered as
    // text next to a ring whose stroke is driven by the same number, so an
    // interval's drift would let the two visibly disagree.
    const step = (now) => {
      const ratio = Math.min((now - start) / DISPATCH_MS, 1);
      // Starts at 1%, never 0 — a ticker that begins on zero reads as stalled.
      setProgress(Math.max(1, Math.round(ratio * 100)));
      if (ratio < 1) frameRef.current = requestAnimationFrame(step);
      else setPhase('done');
    };
    frameRef.current = requestAnimationFrame(step);
    return () => {
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
    };
  }, [reduced]);

  // Escape closes, and focus lands on the close button once the sequence
  // resolves so the dialog is dismissable by keyboard.
  useEffect(() => {
    const onKeyDown = (e) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  useEffect(() => {
    if (phase === 'done') closeRef.current?.focus();
  }, [phase]);

  // Body scroll lock, matching the mobile drawer's behaviour in Layout.jsx.
  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = '';
    };
  }, []);

  if (!dispatch) return null;
  const sent = dispatch.status === 'sent';
  const resolved = phase === 'done';

  // Ring geometry — circumference drives strokeDashoffset so the arc tracks
  // the same integer the ticker prints.
  const R = 52;
  const CIRC = 2 * Math.PI * R;

  return (
    <motion.div
      className="sms-pop-overlay"
      variants={overlayVariants}
      initial="initial"
      animate="animate"
      exit="exit"
      // mousedown, not click: a click that STARTS inside the dialog and ends
      // on the backdrop (a drag while selecting the message text) would
      // otherwise dismiss it.
      onMouseDown={onClose}
    >
      <motion.div
        className="sms-pop-center"
        variants={popVariants}
        initial="initial"
        animate="animate"
        exit="exit"
        role="dialog"
        aria-modal="true"
        aria-live="polite"
        aria-label={t('contributions.sms.popTitle')}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="sms-pop-center__stage">
          <AnimatePresence mode="wait">
            {!resolved ? (
              <motion.div
                key="ticking"
                className="sms-pop-center__ring-wrap"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0, scale: 0.85, transition: { duration: 0.18 } }}
              >
                <svg className="sms-pop-center__ring" viewBox="0 0 130 130" aria-hidden="true">
                  <circle className="sms-pop-center__ring-track" cx="65" cy="65" r={R} />
                  <circle
                    className="sms-pop-center__ring-bar"
                    cx="65"
                    cy="65"
                    r={R}
                    strokeDasharray={CIRC}
                    strokeDashoffset={CIRC * (1 - progress / 100)}
                  />
                </svg>
                <div className="sms-pop-center__percent tabular-nums" aria-hidden="true">
                  {progress}
                  <span className="sms-pop-center__percent-sign">%</span>
                </div>
              </motion.div>
            ) : (
              <motion.div key="resolved" className="sms-pop-center__badge-wrap" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                {sent ? (
                  <>
                    <motion.span className="sms-pop-center__badge-ring" variants={ringVariants} initial="hidden" animate="visible" />
                    <motion.span
                      className="sms-pop-center__badge"
                      variants={tickVariants}
                      initial="hidden"
                      animate="visible"
                    >
                      <FiCheck aria-hidden="true" />
                    </motion.span>
                  </>
                ) : (
                  <motion.span
                    className={`sms-pop-center__badge is-${dispatch.status === 'failed' ? 'failed' : 'neutral'}`}
                    variants={tickVariants}
                    initial="hidden"
                    animate="visible"
                  >
                    {dispatch.status === 'failed' ? <FiAlertTriangle aria-hidden="true" /> : <FiInfo aria-hidden="true" />}
                  </motion.span>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <div className="sms-pop-center__title">
          {!resolved
            ? t('contributions.sms.dispatching')
            : sent
              ? t('contributions.sms.deliveredTitle')
              : t(`contributions.sms.${dispatch.status}`)}
        </div>

        {resolved && !sent && (
          <div className="sms-pop-center__reason">
            {dispatch.reasonCode
              ? t(`contributions.sms.reasonCode.${dispatch.reasonCode}`)
              : dispatch.reason && t('contributions.sms.reason', { reason: dispatch.reason })}
          </div>
        )}

        {/* The exact body the server handed the provider — the same string
            persisted to sms_log.body — so the treasurer sees precisely what
            the member received rather than a client-side reconstruction that
            could drift from it. Monospace and pre-wrapped because the
            message's line breaks ARE its formatting. */}
        {/* Portal-enable and PIN-reset messages embed the member's raw PIN,
            so the server strips the preview before responding
            (enrollment.service.js#withoutPinPreview). Saying so is better
            than a silently missing block that looks like a bug. */}
        {resolved && sent && dispatch.pinWithheld && (
          <div className="sms-pop-center__reason">{t('contributions.sms.previewWithheld')}</div>
        )}

        {resolved && sent && dispatch.preview && (
          <motion.div
            className="sms-pop-center__preview-wrap"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.32, delay: 0.14, ease: [0.22, 1, 0.36, 1] }}
          >
            <div className="sms-pop-center__preview-label">{t('contributions.sms.previewLabel')}</div>
            <pre className="sms-pop-center__preview">{dispatch.preview}</pre>
          </motion.div>
        )}

        {resolved && (
          <div className="sms-pop-center__actions">
            {!sent && dispatch.status === 'failed' && onRetry && (
              <button type="button" className="btn btn--secondary" onClick={onRetry} disabled={retrying}>
                <FiRefreshCw aria-hidden="true" /> {retrying ? t('common.loading') : t('contributions.retrySms')}
              </button>
            )}
            <button type="button" className="btn btn--primary" onClick={onClose} ref={closeRef}>
              <FiX aria-hidden="true" /> {t('common.close')}
            </button>
          </div>
        )}
      </motion.div>
    </motion.div>
  );
}
