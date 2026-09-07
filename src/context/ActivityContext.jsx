import { createContext, useCallback, useContext, useMemo, useState } from 'react';

// In-session activity feed behind the navbar's notification bell.
//
// SCOPE, stated plainly: this is a CLIENT-SIDE, IN-MEMORY feed of things
// that happened in THIS browser tab during THIS session. There is no
// notifications table, endpoint or push channel in the product, so it does
// not and cannot show activity from other users, other devices, or before
// the page was loaded — and it is deliberately cleared by a reload rather
// than persisted, because a stale "3 new" badge restored from localStorage
// would describe events the user already watched happen.
//
// That is a real limitation, not a placeholder: the bell now reports
// something true and useful (the outcome of actions taken here) instead of
// being permanently empty chrome. When a server-side feed exists, the
// provider is the single place to merge it in — every consumer already
// reads `events`/`unseen` from this hook.
const ActivityContext = createContext(null);

// Enough to fill the panel without letting a long bookkeeping session grow
// an unbounded array.
const MAX_EVENTS = 30;

export function ActivityProvider({ children }) {
  const [events, setEvents] = useState([]);
  const [unseen, setUnseen] = useState(0);

  /**
   * Records a completed operation. Call it only AFTER the server has
   * confirmed the action — this feed must never claim something happened
   * that did not, which is the same rule the SMS tick follows.
   *
   * `kind` is a free-form category ('contribution' | 'expense' | 'member' |
   * 'sms') used only to pick an icon.
   */
  const recordActivity = useCallback(({ kind = 'general', message }) => {
    if (!message) return;
    setEvents((prev) => [{ id: `${Date.now()}-${prev.length}`, kind, message, at: new Date() }, ...prev].slice(0, MAX_EVENTS));
    setUnseen((n) => n + 1);
  }, []);

  // Called when the panel is opened — the count describes what the user has
  // not looked at, so opening it is what clears it.
  const markAllSeen = useCallback(() => setUnseen(0), []);

  const clearActivity = useCallback(() => {
    setEvents([]);
    setUnseen(0);
  }, []);

  const value = useMemo(
    () => ({ events, unseen, recordActivity, markAllSeen, clearActivity }),
    [events, unseen, recordActivity, markAllSeen, clearActivity]
  );

  return <ActivityContext.Provider value={value}>{children}</ActivityContext.Provider>;
}

/**
 * Safe outside the provider: the member portal and the platform console
 * mount their own shells and have no bell, so a page shared between them
 * calling recordActivity() must not crash. The no-op fallback keeps those
 * call sites honest without forcing every layout to wrap itself.
 */
const NOOP_ACTIVITY = {
  events: [],
  unseen: 0,
  recordActivity: () => {},
  markAllSeen: () => {},
  clearActivity: () => {},
};

// eslint-disable-next-line react-refresh/only-export-components
export function useActivity() {
  return useContext(ActivityContext) ?? NOOP_ACTIVITY;
}
