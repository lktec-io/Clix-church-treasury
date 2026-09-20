import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import sw from './sw.json';

const STORAGE_KEY = 'clix.locale';
// Swahili is the default experience for this Tanzanian church product
// (docs/MASTER_TODO.md premium-UI pass §3) — English remains fully
// available via the locale switcher in Layout.jsx/MemberLayout.jsx, and a
// user's explicit choice is still what readStoredLocale() honors above.
const DEFAULT_LOCALE = 'sw';

// ONLY THE DEFAULT DICTIONARY IS BUNDLED.
//
// Both dictionaries together were ~74 KB of the main JS payload, and no
// session ever reads more than one of them. The default is imported
// statically because it is what almost every session renders and what every
// missing key falls back to — making IT a request would put a round trip in
// front of the first paint on a phone on mobile data, which is the opposite
// of a saving. English is fetched on demand: on the rare boot that starts in
// English, and when someone uses the switcher.
const LOADERS = {
  sw: null, // already here
  en: () => import('./en.json'),
};

const SUPPORTED = Object.keys(LOADERS);

const LocaleContext = createContext(null);

function readStoredLocale() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored && SUPPORTED.includes(stored) ? stored : DEFAULT_LOCALE;
  } catch {
    return DEFAULT_LOCALE;
  }
}

export function LocaleProvider({ children }) {
  const [locale, setLocaleState] = useState(readStoredLocale);
  // Dictionaries resolved so far, the default one already in hand.
  const [dictionaries, setDictionaries] = useState({ [DEFAULT_LOCALE]: sw });

  const loaded = dictionaries[locale] !== undefined;

  // Fetches the active dictionary when it is not the bundled one. Runs on
  // boot for a stored English preference and again on every switch; an
  // already-loaded dictionary is kept, so switching back and forth costs one
  // request per language for the whole session.
  useEffect(() => {
    if (loaded) return undefined;
    let cancelled = false;
    LOADERS[locale]?.()
      .then((module) => {
        if (cancelled) return;
        setDictionaries((current) => ({ ...current, [locale]: module.default }));
      })
      .catch(() => {
        // The language file could not be fetched (offline mid-switch). Fall
        // back to the bundled dictionary rather than rendering bare keys:
        // the wrong language is readable, `contributions.amount` is not.
        if (!cancelled) setDictionaries((current) => ({ ...current, [locale]: sw }));
      });
    return () => {
      cancelled = true;
    };
  }, [locale, loaded]);

  const setLocale = useCallback((next) => {
    if (!SUPPORTED.includes(next)) return;
    setLocaleState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Non-fatal — locale choice just won't persist across reloads.
    }
  }, []);

  // Falls back to the key itself if a translation is missing, so a gap in
  // one dictionary never breaks rendering — it just surfaces the untranslated
  // key visibly, which is easy to spot and fix (docs/DEVELOPMENT_RULES.md
  // §5: no hardcoded strings, but a missing key must never crash the page).
  // Optional second argument does `{{name}}`-style interpolation (mirrors
  // the backend's sms/smsTemplates.js#renderTemplate) — added for the
  // member portal's "Welcome, {{name}}" greeting; every pre-existing
  // `t('key')` call with no second argument is unaffected.
  const t = useCallback(
    (key, params) => {
      const active = dictionaries[locale];
      const template = active?.[key] ?? dictionaries[DEFAULT_LOCALE]?.[key] ?? key;
      if (!params) return template;
      return template.replace(/\{\{(\w+)\}\}/g, (_match, paramKey) =>
        params[paramKey] !== undefined && params[paramKey] !== null ? String(params[paramKey]) : ''
      );
    },
    [dictionaries, locale]
  );

  const value = useMemo(() => ({ locale, setLocale, t }), [locale, setLocale, t]);

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useLocale() {
  const ctx = useContext(LocaleContext);
  if (!ctx) throw new Error('useLocale must be used within a LocaleProvider');
  return ctx;
}
