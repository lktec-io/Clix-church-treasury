import { motion, AnimatePresence } from 'framer-motion';
import { FiSun, FiMoon } from 'react-icons/fi';
import { useTheme } from '../../context/ThemeContext.jsx';
import { useLocale } from '../../i18n/LocaleContext.jsx';

// Sun/moon crossfade. Both icons are absolutely stacked inside a fixed-size
// button so the swap never nudges the topbar's layout by a pixel.
const iconVariants = {
  hidden: { opacity: 0, rotate: -70, scale: 0.6 },
  visible: { opacity: 1, rotate: 0, scale: 1 },
  exit: { opacity: 0, rotate: 70, scale: 0.6 },
};

export default function ThemeToggle() {
  const { isDark, toggleTheme } = useTheme();
  const { t } = useLocale();
  const label = isDark ? t('nav.theme.toLight') : t('nav.theme.toDark');

  return (
    <button type="button" className="topbar-btn" onClick={toggleTheme} aria-label={label} title={label}>
      <span className="topbar-btn__icon-stack">
        <AnimatePresence initial={false} mode="wait">
          <motion.span
            key={isDark ? 'moon' : 'sun'}
            variants={iconVariants}
            initial="hidden"
            animate="visible"
            exit="exit"
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
          >
            {isDark ? <FiMoon aria-hidden="true" /> : <FiSun aria-hidden="true" />}
          </motion.span>
        </AnimatePresence>
      </span>
    </button>
  );
}
