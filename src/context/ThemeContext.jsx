import { createContext, useContext, useEffect, useMemo, useState } from 'react';

// Light/dark switching for the emerald palette. themes.css holds
// the two token sets (:root and :root[data-theme='dark']); this context does
// nothing but decide which one is active and remember the choice.
//
// The attribute is written to <html> rather than <body> because index.css
// sets `color-scheme` and the page background on :root — a body-level
// attribute would leave the area outside the app shell (overscroll gutters,
// the space under a short page) painted in the wrong mode.

const STORAGE_KEY = 'clix.theme';
const ThemeContext = createContext(null);

// White is the default for everyone. Dark is only ever an explicit choice
// the user made in the profile menu — the OS preference is deliberately not
// consulted, so a treasurer on a dark-mode phone still gets the white ledger.
function readStoredTheme() {
  try {
    if (localStorage.getItem(STORAGE_KEY) === 'dark') return 'dark';
  } catch {
    // Private mode / storage disabled — default below.
  }
  return 'light';
}

export function ThemeProvider({ children }) {
  const [theme, setTheme] = useState(readStoredTheme);

  useEffect(() => {
    // 'light' is the default palette on bare :root, so the attribute is
    // removed rather than set to "light" — that keeps the DOM honest about
    // which selector is actually doing the work.
    if (theme === 'dark') document.documentElement.setAttribute('data-theme', 'dark');
    else document.documentElement.removeAttribute('data-theme');

    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      // Non-fatal — the choice just won't survive a reload.
    }
  }, [theme]);

  const value = useMemo(
    () => ({
      theme,
      isDark: theme === 'dark',
      toggleTheme: () => setTheme((t) => (t === 'dark' ? 'light' : 'dark')),
    }),
    [theme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within a ThemeProvider');
  return ctx;
}
