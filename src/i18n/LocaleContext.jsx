import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import en from './en.json';
import sw from './sw.json';

const DICTIONARIES = { en, sw };
const STORAGE_KEY = 'clix.locale';
const DEFAULT_LOCALE = 'en';

const LocaleContext = createContext(null);

function readStoredLocale() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored && DICTIONARIES[stored] ? stored : DEFAULT_LOCALE;
  } catch {
    return DEFAULT_LOCALE;
  }
}

export function LocaleProvider({ children }) {
  const [locale, setLocaleState] = useState(readStoredLocale);

  const setLocale = useCallback((next) => {
    if (!DICTIONARIES[next]) return;
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
      const template = DICTIONARIES[locale]?.[key] ?? DICTIONARIES[DEFAULT_LOCALE]?.[key] ?? key;
      if (!params) return template;
      return template.replace(/\{\{(\w+)\}\}/g, (_match, paramKey) =>
        params[paramKey] !== undefined && params[paramKey] !== null ? String(params[paramKey]) : ''
      );
    },
    [locale]
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
