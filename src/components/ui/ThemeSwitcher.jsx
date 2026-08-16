import { useTheme } from '../../context/ThemeContext.jsx';
import { useLocale } from '../../i18n/LocaleContext.jsx';

const LABELS = {
  aurora: { en: 'Aurora', sw: 'Aurora' },
  midnight: { en: 'Midnight', sw: 'Midnight' },
  frost: { en: 'Frost', sw: 'Frost' },
};

// Three swatch buttons, no text label needed once you can see the colors —
// same interaction pattern as a native color-scheme picker. Shared between
// the staff sidebar footer and the member topbar so both surfaces offer
// the identical three themes.
export default function ThemeSwitcher() {
  const { theme, setTheme, themes } = useTheme();
  const { locale } = useLocale();

  return (
    <div className="theme-switcher" role="radiogroup" aria-label="Theme">
      {themes.map((option) => (
        <button
          key={option}
          type="button"
          role="radio"
          aria-checked={theme === option}
          aria-label={LABELS[option][locale] ?? LABELS[option].en}
          title={LABELS[option][locale] ?? LABELS[option].en}
          className={`theme-switcher__option theme-switcher__option--${option}${theme === option ? ' is-active' : ''}`}
          onClick={() => setTheme(option)}
        />
      ))}
    </div>
  );
}
