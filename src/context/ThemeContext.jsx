import { createContext, useContext, useEffect, useState } from 'react';

const THEMES = ['aurora', 'midnight', 'frost'];
const DEFAULT_THEME = 'aurora';
const STORAGE_KEY = 'clix.theme';

const ThemeContext = createContext(null);

function readStoredTheme() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return THEMES.includes(stored) ? stored : DEFAULT_THEME;
  } catch {
    return DEFAULT_THEME;
  }
}

// One shared theme across the whole app — staff shell AND member portal —
// so a treasurer and a member never see a visually different product.
// data-theme on <html> is what src/styles/themes.css actually keys off;
// this provider's only job is choosing that attribute's value and
// persisting the choice, every other visual change follows automatically
// from the CSS custom properties themes.css defines per data-theme.
export function ThemeProvider({ children }) {
  const [theme, setThemeState] = useState(readStoredTheme);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  const setTheme = (next) => {
    if (!THEMES.includes(next)) return;
    setThemeState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Non-fatal — the choice just won't survive a reload.
    }
  };

  return <ThemeContext.Provider value={{ theme, setTheme, themes: THEMES }}>{children}</ThemeContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within a ThemeProvider');
  return ctx;
}
