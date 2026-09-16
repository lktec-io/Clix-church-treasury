import { useEffect, useState } from 'react';
import { baseURL } from '../../api/client.js';
import { useLocale } from '../../i18n/LocaleContext.jsx';

// Live system status for the global header.
//
// Two independent real signals, not a decorative "online" badge:
//   · the browser's own network state (online/offline events), and
//   · whether the API server actually answers its /health endpoint, polled.
// A treasurer recording collections needs to know BEFORE pressing Save
// whether the entry can reach the server — "connected to the internet" and
// "the treasury server is up" are different failures and are reported as
// such.
const POLL_MS = 60_000;
const TIMEOUT_MS = 8_000;

// /health lives at the API origin root, not under /api/v1.
function healthUrl() {
  try {
    return `${new URL(baseURL, window.location.origin).origin}/health`;
  } catch {
    return '/health';
  }
}

export default function SystemStatus() {
  const { t } = useLocale();
  const [online, setOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine));
  // 'checking' | 'up' | 'down'
  const [api, setApi] = useState('checking');

  useEffect(() => {
    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const url = healthUrl();

    const check = async () => {
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS), cache: 'no-store' });
        if (!cancelled) setApi(res.ok ? 'up' : 'down');
      } catch {
        if (!cancelled) setApi('down');
      }
    };

    check();
    const id = setInterval(check, POLL_MS);
    // Re-check the moment the tab comes back into view, so a laptop woken
    // after an hour does not show a stale "online" for up to a minute.
    const onVisible = () => {
      if (document.visibilityState === 'visible') check();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [online]);

  const state = !online ? 'offline' : api === 'down' ? 'degraded' : api === 'checking' ? 'checking' : 'online';

  return (
    <span className={`system-status is-${state}`} role="status" aria-live="polite" title={t(`status.${state}.detail`)}>
      <span className="status-dot" aria-hidden="true" />
      <span className="system-status__label">{t(`status.${state}`)}</span>
    </span>
  );
}
