import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { FiCheck, FiRefreshCw, FiAlertTriangle, FiInfo } from 'react-icons/fi';
import { useLocale } from '../../i18n/LocaleContext.jsx';

// Dispatch feedback for a contribution's confirmation SMS.
//
// IMPORTANT — what is and isn't real here:
//
// The 1% → 100% bar is a PRESENTATION of work already finished. The server
// sends the SMS synchronously and the outcome is already in the response
// before this component ever mounts; there is no progress to stream, and
// Beem exposes no delivery-receipt webhook this app subscribes to. The bar
// gives the eye something to follow during a moment that would otherwise
// snap, nothing more.
//
// The OUTCOME is not simulated. The green tick renders only when the server
// actually reported status === 'sent'. A failure resolves into the failure
// state with its real reason and a retry action. Showing a tick for an SMS
// that never arrived would tell a clerk a member has their receipt when
// they do not — the one thing this component must never do.
const DISPATCH_MS = 1500;

const tickVariants = {
  hidden: { scale: 0, rotate: -30, opacity: 0 },
  visible: {
    scale: 1,
    rotate: 0,
    opacity: 1,
    transition: { type: 'spring', stiffness: 340, damping: 14 },
  },
};

function prefersReducedMotion() {
  return typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

// The caller mounts this with key={dispatchId}, so a resend REMOUNTS it and
// the lazy state initialisers below re-run. That's what resets the sequence
// — not a setState inside an effect, which would cost an extra render pass
// and trip react-hooks/set-state-in-effect.
export default function SmsDispatchIndicator({
  status,
  reasonCode,
  reason,
  preview,
  onRetry,
  retrying = false,
}) {
  const { t } = useLocale();
  // Reduced motion skips straight to the outcome: an unprompted 1.5s
  // animation is precisely what that setting asks us not to play.
  const [phase, setPhase] = useState(() => (prefersReducedMotion() ? 'done' : 'dispatching'));
  const [progress, setProgress] = useState(() => (prefersReducedMotion() ? 100 : 0));
  const frameRef = useRef(null);

  useEffect(() => {
    if (prefersReducedMotion()) return undefined;

    const start = performance.now();

    // rAF rather than setInterval: the percentage is rendered as text, and
    // an interval drifts against the CSS-driven bar width, so the number
    // and the bar would visibly disagree.
    const step = (now) => {
      const elapsed = now - start;
      const ratio = Math.min(elapsed / DISPATCH_MS, 1);
      setProgress(Math.max(1, Math.round(ratio * 100)));
      if (ratio < 1) {
        frameRef.current = requestAnimationFrame(step);
      } else {
        setPhase('done');
      }
    };
    frameRef.current = requestAnimationFrame(step);

    return () => {
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
    };
  }, []);

  const sent = status === 'sent';

  return (
    <div className={`sms-dispatch${phase === 'done' && sent ? ' is-sent' : ''}`}>
      <AnimatePresence mode="wait">
        {phase === 'dispatching' ? (
          <motion.div
            key="dispatching"
            className="sms-dispatch__progress"
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6, transition: { duration: 0.18 } }}
          >
            <div className="sms-dispatch__progress-head">
              <span>{t('contributions.sms.dispatching')}</span>
              <span className="sms-dispatch__percent tabular-nums">{progress}%</span>
            </div>
            <div className="sms-dispatch__track" role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}>
              <motion.div className="sms-dispatch__bar" animate={{ width: `${progress}%` }} transition={{ duration: 0 }} />
            </div>
          </motion.div>
        ) : (
          <motion.div
            key="done"
            className="sms-dispatch__result"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
          >
            {sent ? (
              <>
                <motion.span className="sms-dispatch__tick" variants={tickVariants} initial="hidden" animate="visible">
                  <FiCheck aria-hidden="true" />
                </motion.span>
                <div className="sms-dispatch__copy">
                  <div className="sms-dispatch__title">{t('contributions.sms.deliveredTitle')}</div>
                  {preview && <pre className="sms-dispatch__preview">{preview}</pre>}
                </div>
              </>
            ) : (
              <>
                <span className={`sms-dispatch__icon${status === 'failed' ? ' is-failed' : ''}`}>
                  {status === 'failed' ? <FiAlertTriangle aria-hidden="true" /> : <FiInfo aria-hidden="true" />}
                </span>
                <div className="sms-dispatch__copy">
                  <div className="sms-dispatch__title">{t(`contributions.sms.${status}`)}</div>
                  {reasonCode ? (
                    <div className="sms-dispatch__reason">{t(`contributions.sms.reasonCode.${reasonCode}`)}</div>
                  ) : (
                    reason && <div className="sms-dispatch__reason">{t('contributions.sms.reason', { reason })}</div>
                  )}
                </div>
                {status === 'failed' && onRetry && (
                  <button type="button" className="btn btn--secondary btn--sm" onClick={onRetry} disabled={retrying}>
                    <FiRefreshCw aria-hidden="true" /> {retrying ? t('common.loading') : t('contributions.retrySms')}
                  </button>
                )}
              </>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
